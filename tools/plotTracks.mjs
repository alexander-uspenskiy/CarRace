// Dumps the 3 tracks as ASCII (and optionally SVG) so control points can be eyeballed.
//   node tools/plotTracks.mjs [--svg outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKS, getTrackModel } from '../src/data/tracks/index.js';

function ascii(m, W = 110) {
  const bw = m.bbox.maxX - m.bbox.minX;
  const bh = m.bbox.maxY - m.bbox.minY;
  const sc = (W - 1) / bw;
  const H = Math.ceil((bh * sc) / 2) + 1; // characters are ~2x taller than wide
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  for (let i = 0; i < m.N; i++) {
    const px = Math.round((m.x[i] - m.bbox.minX) * sc);
    const py = Math.round(((m.y[i] - m.bbox.minY) * sc) / 2);
    g[py][px] = i === 0 ? 'S' : i * m.ds < 60 ? '>' : '#';
  }
  return g.map((r) => r.join('')).join('\n');
}

function svg(m) {
  const pad = 40;
  const w = m.bbox.maxX - m.bbox.minX + 2 * pad;
  const h = m.bbox.maxY - m.bbox.minY + 2 * pad;
  const ring = (d) => {
    let p = '';
    for (let i = 0; i < m.N; i++) p += `${i ? 'L' : 'M'}${(m.x[i] + d * m.nx[i] - m.bbox.minX + pad).toFixed(1)},${(m.y[i] + d * m.ny[i] - m.bbox.minY + pad).toFixed(1)}`;
    return p + 'Z';
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>` +
    `<path d="${ring(m.wallOffset)}" fill="none" stroke="#c33" stroke-width="1"/><path d="${ring(-m.wallOffset)}" fill="none" stroke="#c33" stroke-width="1"/>` +
    `<path d="${ring(m.halfWidth)}" fill="none" stroke="#000"/><path d="${ring(-m.halfWidth)}" fill="none" stroke="#000"/></svg>`;
}

const i = process.argv.indexOf('--svg');
const outDir = i > 0 ? process.argv[i + 1] : null;
if (outDir) mkdirSync(outDir, { recursive: true });
for (const def of TRACKS) {
  const m = getTrackModel(def.id);
  console.log(`\n=== ${def.name} (${def.id})  length ${m.length.toFixed(0)} m  corners ${m.stats.corners}  longest straight ${m.stats.longestStraight.toFixed(0)} m  ref lap ${def.referenceLapTime} s`);
  console.log(ascii(m));
  if (outDir) writeFileSync(join(outDir, `${def.id}.svg`), svg(m));
}
