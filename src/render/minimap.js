// Minimap (HUD) and static track map (track select). North-up: sim (x,y) -> canvas (x,y), uniform scale + centring.

/** Uniform fit of a bbox into a size x size (or w x h) box with padding. canvas = o + (p - min) * scale */
export function computeMapTransform(bbox, w, h = w, padding = 12) {
  const bw = Math.max(1e-6, bbox.maxX - bbox.minX);
  const bh = Math.max(1e-6, bbox.maxY - bbox.minY);
  const scale = Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh);
  const ox = (w - bw * scale) / 2 - bbox.minX * scale;
  const oy = (h - bh * scale) / 2 - bbox.minY * scale;
  return { scale, ox, oy };
}
export const mapX = (t, x) => t.ox + x * t.scale;
export const mapY = (t, y) => t.oy + y * t.scale;

function tracePath(ctx, model, t, step) {
  ctx.beginPath();
  const N = model.N;
  for (let i = 0; i <= N; i += step) {
    const k = i % N;
    const px = mapX(t, model.x[k]);
    const py = mapY(t, model.y[k]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawStartTick(ctx, model, t, len, color = '#ffffff', w = 3) {
  const nx = model.nx[0];
  const ny = model.ny[0];
  const cx = mapX(t, model.x[0]);
  const cy = mapY(t, model.y[0]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(cx - nx * len, cy - ny * len);
  ctx.lineTo(cx + nx * len, cy + ny * len);
  ctx.stroke();
}

/** Static preview for the track select screen. highlight: optional {s0, s1, color} metre range drawn on top. */
export function drawTrackMap(canvas, model, { padding = 16, stroke = '#ffffff', width = 6, showStart = true, highlight = null } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const t = computeMapTransform(model.bbox, w, h, padding);
  const step = Math.max(1, Math.floor(model.N / 500));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = width + 4;
  tracePath(ctx, model, t, step);
  ctx.stroke();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  tracePath(ctx, model, t, step);
  ctx.stroke();
  if (highlight) {
    const i0 = Math.floor(model.wrapS(highlight.s0) / model.ds);
    const i1 = Math.floor(model.wrapS(highlight.s1) / model.ds);
    ctx.strokeStyle = highlight.color || '#ffcc00';
    ctx.lineWidth = width;
    ctx.beginPath();
    let i = i0;
    ctx.moveTo(mapX(t, model.x[i]), mapY(t, model.y[i]));
    let guard = 0;
    while (i !== i1 && guard++ < model.N) {
      i = (i + step) % model.N;
      ctx.lineTo(mapX(t, model.x[i]), mapY(t, model.y[i]));
    }
    ctx.stroke();
  }
  if (showStart) drawStartTick(ctx, model, t, width * 1.1 + 3, '#ff3b3b', Math.max(3, width * 0.6));
  return t;
}

export class Minimap {
  constructor(canvas2d, trackModel, { size = 200, rotate = false } = {}) {
    this.canvas = canvas2d;
    this.model = trackModel;
    this.size = size;
    this.rotate = rotate;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.dpr = dpr;
    canvas2d.width = Math.round(size * dpr);
    canvas2d.height = Math.round(size * dpr);
    if (canvas2d.style && !canvas2d.style.width) {
      canvas2d.style.width = size + 'px';
      canvas2d.style.height = size + 'px';
    }
    this.ctx = canvas2d.getContext('2d');
    this.t = computeMapTransform(trackModel.bbox, size, size, 14);
    // static layer: translucent panel + track path + start tick
    this.base = document.createElement('canvas');
    this.base.width = canvas2d.width;
    this.base.height = canvas2d.height;
    const b = this.base.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = 'rgba(10,12,18,0.55)';
    b.beginPath();
    if (b.roundRect) b.roundRect(0, 0, size, size, 12);
    else b.rect(0, 0, size, size);
    b.fill();
    b.lineJoin = 'round';
    b.lineCap = 'round';
    const step = Math.max(1, Math.floor(trackModel.N / 400));
    b.strokeStyle = 'rgba(0,0,0,0.6)';
    b.lineWidth = 7;
    tracePath(b, trackModel, this.t, step);
    b.stroke();
    b.strokeStyle = 'rgba(235,238,245,0.85)';
    b.lineWidth = 4;
    tracePath(b, trackModel, this.t, step);
    b.stroke();
    drawStartTick(b, trackModel, this.t, 6, '#ff3b3b', 3);
  }

  /** snapshot: RaceSnapshot. Cars drawn in team colour, player ringed in white (last, on top). */
  draw(snapshot) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const size = this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cars = snapshot && snapshot.cars;
    const pl = cars ? cars[snapshot.playerId] : null;
    if (this.rotate && pl) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.clip();
      // player-up: rotate the world so the player's heading points up
      ctx.translate(size / 2, size / 2);
      ctx.rotate(-pl.heading - Math.PI / 2);
      ctx.translate(-mapX(this.t, pl.x), -mapY(this.t, pl.y));
      ctx.drawImage(this.base, 0, 0, this.base.width / dpr, this.base.height / dpr);
      this._dots(ctx, cars, snapshot.playerId);
      ctx.restore();
      return;
    }
    ctx.drawImage(this.base, 0, 0, size, size);
    if (cars) this._dots(ctx, cars, snapshot.playerId);
  }

  _dots(ctx, cars, playerId) {
    const t = this.t;
    for (let i = 0; i < cars.length; i++) {
      if (i === playerId) continue;
      const c = cars[i];
      ctx.fillStyle = c.color || '#ccc';
      ctx.beginPath();
      ctx.arc(mapX(t, c.x), mapY(t, c.y), 3.2, 0, 6.2832);
      ctx.fill();
    }
    const p = cars[playerId];
    if (p) {
      const x = mapX(t, p.x);
      const y = mapY(t, p.y);
      ctx.fillStyle = p.color || '#fff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 6.2832);
      ctx.fill();
      ctx.stroke();
    }
  }
}
