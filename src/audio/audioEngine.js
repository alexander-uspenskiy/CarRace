// WebAudio synthesis only (no samples). Create with `new AudioEngine()`, call init() from a user gesture.
// Graph: [engine osc stack -> shaper -> lowpass] + [noise voices] -> simBus -> master -> compressor -> out;  SFX -> sfxBus -> master.

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function makeSoftClipCurve(k = 2.2, n = 512) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.7;
    this.paused = false;
    this._lastUpdate = 0;
    this._stale = false;
    this._gear = 1;
    this._dip = 0;
    this._watch = null;
    this._noiseBuf = null;
    this.n = null; // nodes
  }

  get isRunning() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture (pointerdown/keydown). Idempotent; also resumes a suspended context. */
  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this._build(ctx);
      this.ready = true;
      this.resume();
      this._lastUpdate = typeof performance !== 'undefined' ? performance.now() : 0;
      this._watch = setInterval(() => this._watchdog(), 300);
    } catch (e) {
      this.ctx = null;
      this.ready = false;
      console.error('AudioEngine init failed', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  _noiseSource(offset = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = true;
    s.start(0, offset);
    return s;
  }

  _build(ctx) {
    const n = {};
    this.n = n;
    n.master = ctx.createGain();
    n.master.gain.value = this.volume * 0.9;
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -14;
    n.comp.ratio.value = 6;
    n.comp.attack.value = 0.005;
    n.comp.release.value = 0.2;
    n.master.connect(n.comp);
    n.comp.connect(ctx.destination);
    n.simBus = ctx.createGain();
    n.simBus.gain.value = 0;
    n.simBus.connect(n.master);
    n.sfxBus = ctx.createGain();
    n.sfxBus.gain.value = 0.9;
    n.sfxBus.connect(n.master);

    // shared noise buffer (2 s white)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    // ---- engine: 2 detuned saws + sub + 2nd harmonic -> soft clip -> lowpass -> gain
    n.o1 = ctx.createOscillator();
    n.o1.type = 'sawtooth';
    n.o2 = ctx.createOscillator();
    n.o2.type = 'sawtooth';
    n.o3 = ctx.createOscillator();
    n.o3.type = 'triangle';
    n.o4 = ctx.createOscillator();
    n.o4.type = 'sawtooth';
    const g1 = ctx.createGain();
    g1.gain.value = 0.34;
    const g2 = ctx.createGain();
    g2.gain.value = 0.34;
    const g3 = ctx.createGain();
    g3.gain.value = 0.5;
    const g4 = ctx.createGain();
    g4.gain.value = 0.1;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    n.o1.connect(g1).connect(mix);
    n.o2.connect(g2).connect(mix);
    n.o3.connect(g3).connect(mix);
    n.o4.connect(g4).connect(mix);
    n.shaper = ctx.createWaveShaper();
    n.shaper.curve = makeSoftClipCurve(2.4);
    n.shaper.oversample = '2x';
    n.lp = ctx.createBiquadFilter();
    n.lp.type = 'lowpass';
    n.lp.frequency.value = 900;
    n.lp.Q.value = 1.4;
    n.engGain = ctx.createGain();
    n.engGain.gain.value = 0;
    mix.connect(n.shaper).connect(n.lp).connect(n.engGain).connect(n.simBus);
    for (const o of [n.o1, n.o2, n.o3, n.o4]) {
      o.frequency.value = 80;
      o.start();
    }

    // intake / exhaust roar (noise, band-passed by rpm)
    n.roarBp = ctx.createBiquadFilter();
    n.roarBp.type = 'bandpass';
    n.roarBp.frequency.value = 300;
    n.roarBp.Q.value = 0.7;
    n.roarGain = ctx.createGain();
    n.roarGain.gain.value = 0;
    this._noiseSource(0.1).connect(n.roarBp).connect(n.roarGain).connect(n.simBus);

    // tyre squeal
    n.squealBp = ctx.createBiquadFilter();
    n.squealBp.type = 'bandpass';
    n.squealBp.frequency.value = 2000;
    n.squealBp.Q.value = 7;
    n.squealGain = ctx.createGain();
    n.squealGain.gain.value = 0;
    this._noiseSource(0.4).connect(n.squealBp).connect(n.squealGain).connect(n.simBus);

    // wind
    n.windLp = ctx.createBiquadFilter();
    n.windLp.type = 'lowpass';
    n.windLp.frequency.value = 400;
    n.windGain = ctx.createGain();
    n.windGain.gain.value = 0;
    this._noiseSource(0.8).connect(n.windLp).connect(n.windGain).connect(n.simBus);

    // grass / kerb rumble
    n.rumbleLp = ctx.createBiquadFilter();
    n.rumbleLp.type = 'lowpass';
    n.rumbleLp.frequency.value = 170;
    n.rumbleGain = ctx.createGain();
    n.rumbleGain.gain.value = 0;
    this._noiseSource(1.2).connect(n.rumbleLp).connect(n.rumbleGain).connect(n.simBus);

    // ambient: low crowd/track rumble + faint broadband crowd murmur
    n.ambLp = ctx.createBiquadFilter();
    n.ambLp.type = 'lowpass';
    n.ambLp.frequency.value = 110;
    n.ambGain = ctx.createGain();
    n.ambGain.gain.value = 0.16;
    this._noiseSource(1.6).connect(n.ambLp).connect(n.ambGain).connect(n.simBus);
    n.crowdBp = ctx.createBiquadFilter();
    n.crowdBp.type = 'bandpass';
    n.crowdBp.frequency.value = 900;
    n.crowdBp.Q.value = 0.5;
    n.crowdGain = ctx.createGain();
    n.crowdGain.gain.value = 0.012;
    this._noiseSource(1.9).connect(n.crowdBp).connect(n.crowdGain).connect(n.simBus);
  }

  setMasterVolume(v01) {
    this.volume = clamp(+v01 || 0, 0, 1);
    if (this.ready) this.n.master.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.03);
  }

  setPaused(b) {
    this.paused = !!b;
    this._applyBus();
  }

  _applyBus() {
    if (!this.ready) return;
    const on = !this.paused && !this._stale;
    this.n.simBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.05 : 0.04);
  }

  _watchdog() {
    if (!this.ready) return;
    const stale = performance.now() - this._lastUpdate > 450;
    if (stale !== this._stale) {
      this._stale = stale;
      this._applyBus();
    }
  }

  /** playerCar: CarSnapshot. Smoothed parameter updates (call every frame while racing). */
  update(playerCar, dt, snapshot) {
    if (!this.ready || !playerCar) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') this.resume();
    this._lastUpdate = performance.now();
    if (this._stale) {
      this._stale = false;
      this._applyBus();
    }
    if (this.paused) return;
    const n = this.n;
    const t = ctx.currentTime;
    const rpm = clamp(playerCar.rpm || 0, 0, 1);
    const thr = clamp(playerCar.throttle || 0, 0, 1);
    const speed = playerCar.speed || 0;
    const slip = clamp(playerCar.slip || 0, 0, 1);

    if (playerCar.gear !== this._gear) {
      if (playerCar.gear > this._gear) this._dip = 1; // upshift: brief rev dip
      this._gear = playerCar.gear;
    }
    this._dip = Math.max(0, this._dip - dt / 0.16);
    const dip = this._dip;

    const f0 = (55 + 260 * rpm) * (1 - 0.14 * dip);
    const tc = 0.035;
    n.o1.frequency.setTargetAtTime(f0, t, tc);
    n.o2.frequency.setTargetAtTime(f0 * 1.007, t, tc);
    n.o3.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    n.o4.frequency.setTargetAtTime(f0 * 2.0, t, tc);
    n.lp.frequency.setTargetAtTime(450 + 3900 * rpm * (0.45 + 0.55 * thr), t, 0.05);
    n.engGain.gain.setTargetAtTime((0.07 + 0.19 * thr) * (0.65 + 0.35 * rpm) * (1 - 0.55 * dip), t, 0.04);
    n.roarBp.frequency.setTargetAtTime(160 + 900 * rpm, t, 0.06);
    n.roarGain.gain.setTargetAtTime(0.02 + 0.09 * thr * rpm, t, 0.06);

    // tyre squeal: bandpass noise driven by slip
    const sq = slip > 0.12 ? Math.pow((slip - 0.12) / 0.88, 1.3) * clamp(speed / 14, 0, 1) : 0;
    n.squealGain.gain.setTargetAtTime(sq * 0.22, t, 0.05);
    n.squealBp.frequency.setTargetAtTime(1500 + 1700 * slip + speed * 6, t, 0.08);

    // wind
    const w = clamp(speed / 95, 0, 1);
    n.windGain.gain.setTargetAtTime(w * w * 0.16 + 0.004, t, 0.1);
    n.windLp.frequency.setTargetAtTime(280 + 1400 * w, t, 0.1);

    // surface rumble
    let rumble = 0;
    if (playerCar.surface === 'grass') rumble = clamp(speed / 50, 0, 1) * 0.3;
    else if (playerCar.surface === 'kerb') rumble = clamp(speed / 60, 0, 1) * 0.2;
    n.rumbleGain.gain.setTargetAtTime(rumble, t, 0.05);
    n.rumbleLp.frequency.setTargetAtTime(playerCar.surface === 'kerb' ? 240 : 150, t, 0.1);
  }

  // ------------------------------------------------------------------ SFX
  _tone(freq, start, dur, type = 'square', gain = 0.2, endFreq = null) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.n.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  _noiseBurst(start, dur, freq, gain, type = 'lowpass') {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + start;
    const s = ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.n.sfxBus);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.03);
  }

  playSfx(name) {
    if (!this.ready) return;
    this.resume();
    switch (name) {
      case 'lightBeep':
        this._tone(880, 0, 0.16, 'square', 0.16);
        break;
      case 'go':
        this._tone(1320, 0, 0.55, 'square', 0.2);
        this._tone(1980, 0, 0.55, 'sine', 0.1);
        break;
      case 'lapBeep':
        this._tone(660, 0, 0.1, 'sine', 0.2);
        this._tone(990, 0.11, 0.18, 'sine', 0.2);
        break;
      case 'fastestLap':
        [784, 988, 1175, 1568].forEach((f, i) => this._tone(f, i * 0.09, 0.14, 'triangle', 0.2));
        break;
      case 'wall':
        this._noiseBurst(0, 0.4, 900, 0.55);
        this._tone(120, 0, 0.35, 'sine', 0.55, 38);
        break;
      case 'crash':
        this._noiseBurst(0, 0.7, 1400, 0.7);
        this._noiseBurst(0.02, 0.35, 5000, 0.35, 'highpass');
        this._tone(90, 0, 0.5, 'sine', 0.7, 30);
        break;
      case 'contact':
        this._noiseBurst(0, 0.2, 700, 0.3);
        this._tone(150, 0, 0.18, 'sine', 0.35, 70);
        break;
      case 'click':
        this._tone(1250, 0, 0.035, 'square', 0.07);
        break;
      case 'purchase':
        this._tone(1046, 0, 0.09, 'triangle', 0.22);
        this._tone(1568, 0.08, 0.4, 'triangle', 0.22);
        this._noiseBurst(0, 0.08, 6000, 0.08, 'highpass');
        break;
      default:
        break;
    }
  }

  dispose() {
    if (this._watch) clearInterval(this._watch);
    this._watch = null;
    if (this.ctx) {
      try {
        for (const k of ['o1', 'o2', 'o3', 'o4']) this.n[k].stop();
      } catch (e) {
        /* already stopped */
      }
      const p = this.ctx.close();
      if (p && p.catch) p.catch(() => {});
    }
    this.ctx = null;
    this.ready = false;
    this.n = null;
  }
}
