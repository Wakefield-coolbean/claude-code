// Map decoration: floor details, wall fittings and small props that make rooms feel lived in.
// drawDecor runs once per cached map chunk; drawDecorLive draws the few animated bits each frame.
// Layouts are fixed data plus hashed noise (never Math.random), so chunks drawn apart line up.
// Wall fittings sit on the 2-row wall face above a room's top edge: y in [top - 2, top).

import { THEMES } from './map.js';

const INK = '#07090c';
const FONT = '"Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif';
const TAU = Math.PI * 2;
const YELLOW = '#f2c230';
const WARM = '255,241,206';

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ---------- drawing primitives (cell units) ----------

function rr(ctx, x, y, w, h, r, fill, lw = 0.06) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

function disc(ctx, x, y, r, fill, lw = 0.06) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

function oval(ctx, x, y, rx, ry, fill, lw = 0, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

/** Stroke a polyline given as flat [x0, y0, x1, y1, ...]. */
function line(ctx, pts, color, w, cap = 'round') {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// Text is laid out at 32x and scaled down: browsers render sub-pixel font sizes badly.
function text(ctx, s, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / 32, 1 / 32);
  ctx.font = `800 ${Math.round(size * 32)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function textWidth(ctx, s, size) {
  ctx.save();
  ctx.font = `800 ${Math.round(size * 32)}px ${FONT}`;
  const w = ctx.measureText(s).width / 32;
  ctx.restore();
  return w;
}

/** Soft elliptical light on the floor. */
function pool(ctx, x, y, r, a, rgb = WARM) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.6);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.5, `rgba(${rgb},${a * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

function glow(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Yellow and black diagonal stripes filling a rect. */
function hazard(ctx, x, y, w, h, step = 0.44) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  for (let s = x - h - step; s < x + w + step; s += step) {
    ctx.moveTo(s, y + h);
    ctx.lineTo(s + h, y);
    ctx.lineTo(s + h + step / 2, y);
    ctx.lineTo(s + step / 2, y + h);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function stain(ctx, x, y, r, seed, rgb = '28,24,20', a = 0.2) {
  for (let i = 0; i < 4; i++) {
    const s = r * (0.45 + hash(seed + i, 7) * 0.4);
    oval(ctx, x + (hash(seed, i) - 0.5) * r, y + (hash(i, seed) - 0.5) * r * 0.6, s, s * 0.6, `rgba(${rgb},${a})`);
  }
  oval(ctx, x - r * 0.2, y - r * 0.12, r * 0.22, r * 0.09, 'rgba(255,255,255,0.08)');
}

function cable(ctx, pts, color) {
  line(ctx, pts, '#15191e', 0.17);
  line(ctx, pts, color, 0.08);
}

function rug(ctx, [x0, y0, x1, y1], fill, edge) {
  rr(ctx, x0, y0, x1 - x0, y1 - y0, 0.22, fill, 0);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.stroke();
  ctx.lineWidth = 0.08;
  ctx.strokeStyle = edge;
  ctx.beginPath();
  ctx.roundRect(x0 + 0.24, y0 + 0.24, x1 - x0 - 0.48, y1 - y0 - 0.48, 0.12);
  ctx.stroke();
}

function hatch(ctx, x, y, base) {
  const s = 0.95;
  rr(ctx, x - s / 2, y - s / 2, s, s, 0.08, shade(base, 0.93), 0);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = shade(base, 0.7);
  ctx.stroke();
  ctx.fillStyle = shade(base, 0.62);
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    disc(ctx, x + dx * 0.33, y + dy * 0.33, 0.045, shade(base, 0.62), 0);
  rr(ctx, x - 0.2, y - 0.05, 0.4, 0.1, 0.05, shade(base, 0.62), 0);
}

/** Painted floor direction: a label and an arrow pointing l, r, u or d. */
function floorSign(ctx, x, y, label, dir) {
  const size = 0.44;
  const tw = textWidth(ctx, label, size);
  let tx = x;
  let ty = y;
  let ax = x;
  let ay = y;
  if (dir === 'l' || dir === 'r') {
    const total = tw + 0.75;
    const s = dir === 'l' ? -1 : 1;
    ax = x + s * (total / 2 - 0.25);
    tx = x - s * (total / 2 - tw / 2);
  } else {
    ay = y + (dir === 'u' ? -0.42 : 0.42);
    ty = y + (dir === 'u' ? 0.28 : -0.28);
  }
  text(ctx, label, tx, ty, size, 'rgba(232,238,244,0.36)');
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate({ r: 0, d: Math.PI / 2, l: Math.PI, u: -Math.PI / 2 }[dir]);
  ctx.fillStyle = 'rgba(242,194,48,0.55)';
  ctx.beginPath();
  ctx.moveTo(-0.26, -0.08);
  ctx.lineTo(0.02, -0.08);
  ctx.lineTo(0.02, -0.22);
  ctx.lineTo(0.26, 0);
  ctx.lineTo(0.02, 0.22);
  ctx.lineTo(0.02, 0.08);
  ctx.lineTo(-0.26, 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- wall fittings: x is the center, top the floor row under the wall ----------

const signWidth = (s) => 0.17 * s.length + 0.45;

function sign(ctx, x, top, label, th) {
  const w = signWidth(label);
  rr(ctx, x - w / 2, top - 1.72, w, 0.5, 0.1, '#232a33', 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + 0.07, top - 1.65, w - 0.14, 0.36, 0.06);
  ctx.stroke();
  text(ctx, label, x, top - 1.455, 0.27, th[3]);
}

function lamp(ctx, x, top) {
  const g = ctx.createLinearGradient(0, top - 1.62, 0, top - 0.15);
  g.addColorStop(0, `rgba(${WARM},0.3)`);
  g.addColorStop(1, `rgba(${WARM},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 0.18, top - 1.62);
  ctx.lineTo(x + 0.18, top - 1.62);
  ctx.lineTo(x + 0.6, top - 0.2);
  ctx.lineTo(x - 0.6, top - 0.2);
  ctx.fill();
  rr(ctx, x - 0.28, top - 1.9, 0.56, 0.24, 0.08, '#c3ccd5', 0.05);
  rr(ctx, x - 0.2, top - 1.7, 0.4, 0.11, 0.05, '#fff1c4', 0.04);
}

function pipes(ctx, xa, xb, top, th) {
  const body = shade(th[2], 0.7);
  const hi = shade(th[2], 1.3);
  for (const [y, h] of [
    [top - 1.86, 0.17],
    [top - 1.62, 0.12],
  ]) {
    ctx.fillStyle = body;
    ctx.fillRect(xa, y, xb - xa, h);
    ctx.fillStyle = hi;
    ctx.fillRect(xa, y + 0.025, xb - xa, h * 0.28);
    line(ctx, [xa, y, xb, y], INK, 0.035, 'butt');
    line(ctx, [xa, y + h, xb, y + h], INK, 0.035, 'butt');
  }
  ctx.fillStyle = shade(th[2], 0.48);
  for (let x = Math.floor(xa) + 1; x < xb - 0.3; x += 2) ctx.fillRect(x - 0.06, top - 1.92, 0.12, 0.46);
  for (const x of [xa, xb - 0.1]) rr(ctx, x, top - 1.9, 0.1, 0.46, 0.02, shade(th[2], 0.55), 0.035);
}

function gauge(ctx, x, top, seed) {
  ctx.fillStyle = '#59636f';
  ctx.fillRect(x - 0.035, top - 1.5, 0.07, 0.2);
  disc(ctx, x, top - 1.12, 0.22, '#3b434d', 0.05);
  disc(ctx, x, top - 1.12, 0.16, '#ece6d6', 0);
  ctx.strokeStyle = '#d23a2f';
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.arc(x, top - 1.12, 0.12, -0.7, 0.1);
  ctx.stroke();
  const a = -2.5 + hash(seed, 3) * 2.2;
  line(ctx, [x, top - 1.12, x + Math.cos(a) * 0.13, top - 1.12 + Math.sin(a) * 0.13], INK, 0.035);
  disc(ctx, x, top - 1.12, 0.03, INK, 0);
}

function clock(ctx, x, top) {
  const y = top - 1.36;
  disc(ctx, x, y, 0.28, '#3b434d', 0.05);
  disc(ctx, x, y, 0.22, '#f1f3f5', 0);
  ctx.fillStyle = '#59636f';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ctx.fillRect(x + Math.cos(a) * 0.17 - 0.015, y + Math.sin(a) * 0.17 - 0.015, 0.03, 0.03);
  }
  line(ctx, [x, y, x, y - 0.15], INK, 0.035);
  line(ctx, [x, y, x + 0.1, y + 0.04], INK, 0.045);
  disc(ctx, x, y, 0.025, '#d23a2f', 0);
}

function extinguisher(ctx, x, top) {
  rr(ctx, x - 0.22, top - 1.2, 0.44, 0.94, 0.06, 'rgba(255,255,255,0.12)', 0);
  rr(ctx, x - 0.13, top - 0.98, 0.26, 0.74, 0.11, '#d23a2f', 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x - 0.08, top - 0.9, 0.05, 0.56);
  rr(ctx, x - 0.13, top - 0.68, 0.26, 0.12, 0.02, '#f1f3f5', 0.03);
  rr(ctx, x - 0.07, top - 1.1, 0.14, 0.13, 0.03, '#2b2f35', 0.04);
  ctx.beginPath();
  ctx.moveTo(x + 0.06, top - 1.05);
  ctx.quadraticCurveTo(x + 0.27, top - 0.92, x + 0.17, top - 0.5);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.05;
  ctx.stroke();
}

/** Safety poster: a crewmate with a warning bubble. */
function poster(ctx, x, top, tone) {
  const bg = tone ? '#3d5a80' : '#b8433a';
  rr(ctx, x - 0.4, top - 1.82, 0.8, 1.06, 0.04, '#e8ecef', 0.05);
  rr(ctx, x - 0.33, top - 1.75, 0.66, 0.8, 0.03, bg, 0);
  const cx = x - 0.07;
  const cy = top - 1.28;
  rr(ctx, cx - 0.24, cy - 0.1, 0.1, 0.26, 0.04, '#f4f6f8', 0);
  rr(ctx, cx - 0.16, cy - 0.26, 0.32, 0.52, 0.14, '#f4f6f8', 0);
  rr(ctx, cx - 0.02, cy - 0.17, 0.21, 0.13, 0.06, '#7bd1ff', 0);
  ctx.fillStyle = bg;
  ctx.fillRect(cx - 0.02, cy + 0.12, 0.05, 0.14);
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  ctx.moveTo(x + 0.2, top - 1.71);
  ctx.lineTo(x + 0.32, top - 1.5);
  ctx.lineTo(x + 0.08, top - 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(x + 0.19, top - 1.66, 0.025, 0.09);
  ctx.fillRect(x + 0.19, top - 1.55, 0.025, 0.025);
  ctx.fillStyle = 'rgba(244,246,248,0.85)';
  ctx.fillRect(x - 0.24, top - 0.9, 0.48, 0.04);
  ctx.fillRect(x - 0.16, top - 0.84, 0.32, 0.03);
}

function radiation(ctx, x, top) {
  rr(ctx, x - 0.32, top - 1.74, 0.64, 0.64, 0.08, YELLOW, 0.06);
  const cy = top - 1.42;
  ctx.fillStyle = INK;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.arc(x, cy, 0.23, a - 0.52, a + 0.52);
    ctx.closePath();
    ctx.fill();
  }
  disc(ctx, x, cy, 0.08, YELLOW, 0);
  disc(ctx, x, cy, 0.05, INK, 0);
}

function warnSign(ctx, x, top) {
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  ctx.moveTo(x, top - 1.78);
  ctx.lineTo(x + 0.34, top - 1.18);
  ctx.lineTo(x - 0.34, top - 1.18);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  // Lightning bolt.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x + 0.04, top - 1.62);
  ctx.lineTo(x - 0.09, top - 1.42);
  ctx.lineTo(x + 0.01, top - 1.42);
  ctx.lineTo(x - 0.05, top - 1.24);
  ctx.lineTo(x + 0.1, top - 1.47);
  ctx.lineTo(x, top - 1.47);
  ctx.closePath();
  ctx.fill();
}

function grille(ctx, x, top, th) {
  rr(ctx, x - 0.3, top - 1.62, 0.6, 0.52, 0.06, shade(th[2], 0.62), 0.05);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = shade(th[2], 0.4);
    ctx.fillRect(x - 0.22, top - 1.54 + i * 0.11, 0.44, 0.05);
  }
}

function speaker(ctx, x, top, th) {
  rr(ctx, x - 0.28, top - 1.7, 0.56, 0.86, 0.08, shade(th[2], 0.6), 0.05);
  ctx.fillStyle = shade(th[2], 0.35);
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 3; c++) disc(ctx, x - 0.12 + c * 0.12, top - 1.56 + r * 0.14, 0.035, shade(th[2], 0.35), 0);
  disc(ctx, x + 0.16, top - 0.95, 0.04, '#7ad2ff', 0);
}

function cabinet(ctx, x, top) {
  rr(ctx, x - 0.42, top - 1.84, 0.84, 0.92, 0.06, '#eef3f4', 0.06);
  line(ctx, [x, top - 1.8, x, top - 0.96], 'rgba(0,0,0,0.25)', 0.03);
  ctx.fillStyle = '#e0443a';
  ctx.fillRect(x - 0.07, top - 1.66, 0.14, 0.42);
  ctx.fillRect(x - 0.21, top - 1.52, 0.42, 0.14);
  disc(ctx, x - 0.07, top - 1.08, 0.03, '#8f9aa6', 0);
  disc(ctx, x + 0.07, top - 1.08, 0.03, '#8f9aa6', 0);
}

const ECG = [-0.28, 0, -0.12, 0, -0.08, 0.06, -0.04, -0.14, 0.01, 0.12, 0.05, 0, 0.28, 0];

function heartMonitor(ctx, x, top) {
  ctx.fillStyle = '#59636f';
  ctx.fillRect(x - 0.04, top - 1.2, 0.08, 0.32);
  rr(ctx, x - 0.38, top - 1.78, 0.76, 0.6, 0.06, '#2a3440', 0.06);
  rr(ctx, x - 0.31, top - 1.71, 0.62, 0.46, 0.03, '#0d2620', 0);
  const y = top - 1.46;
  const pts = [];
  for (let i = 0; i < ECG.length; i += 2) pts.push(x + ECG[i], y + ECG[i + 1]);
  line(ctx, pts, 'rgba(94,240,138,0.55)', 0.035);
}

function starChart(ctx, x, top, w) {
  rr(ctx, x - w / 2, top - 1.88, w, 1.3, 0.08, '#2a3646', 0.06);
  const ix = x - w / 2 + 0.1;
  const iy = top - 1.78;
  const iw = w - 0.2;
  const ih = 1.1;
  rr(ctx, ix, iy, iw, ih, 0.05, '#0b1630', 0);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 22; i++) ctx.fillRect(ix + hash(i, 41) * iw, iy + hash(41, i) * ih, 0.035, 0.035);
  const sx = x - w * 0.18;
  const sy = iy + ih / 2;
  ctx.strokeStyle = 'rgba(199,236,255,0.4)';
  ctx.lineWidth = 0.025;
  for (const r of [0.3, 0.55, 0.85]) {
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * 1.4, r * 0.55, -0.15, 0, TAU);
    ctx.stroke();
  }
  disc(ctx, sx, sy, 0.1, '#ffd84a', 0);
  disc(ctx, sx + 0.42, sy - 0.08, 0.06, '#7ad2ff', 0);
  disc(ctx, sx - 0.7, sy + 0.24, 0.08, '#ff8a5c', 0);
  disc(ctx, sx + 1.15, sy - 0.2, 0.07, '#9be37a', 0);
  ctx.setLineDash([0.08, 0.06]);
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(sx + 0.42, sy - 0.08);
  ctx.quadraticCurveTo(sx + 0.8, sy - 0.45, sx + 1.15, sy - 0.2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Window out to space, with stars and a couple of drifting rocks. */
function windowPane(ctx, xa, xb, top, seed) {
  const w = xb - xa;
  rr(ctx, xa, top - 1.88, w, 1.54, 0.22, '#3a4250', 0.07);
  const ix = xa + 0.13;
  const iy = top - 1.76;
  const iw = w - 0.26;
  const ih = 1.3;
  rr(ctx, ix, iy, iw, ih, 0.14, '#06101f', 0.04);
  ctx.save();
  ctx.clip();
  glow(ctx, ix + iw * 0.72, iy + ih * 0.4, 1.4, '120,90,200', 0.28);
  for (let i = 0; i < Math.round(iw * 9); i++) {
    const h = hash(seed + i, 5);
    ctx.fillStyle = h < 0.2 ? 'rgba(255,255,255,0.95)' : 'rgba(170,190,255,0.55)';
    const s = 0.03 + h * 0.035;
    ctx.fillRect(ix + hash(i, seed) * iw, iy + hash(seed, i + 9) * ih, s, s);
  }
  for (const [fx, fy, r] of [
    [0.25, 0.6, 0.2],
    [0.62, 0.3, 0.12],
  ]) {
    const cx = ix + iw * fx;
    const cy = iy + ih * fy;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const rr2 = r * (0.75 + hash(seed + i, 11) * 0.4);
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
    }
    ctx.closePath();
    ctx.fillStyle = '#5b5550';
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = INK;
    ctx.stroke();
    disc(ctx, cx - r * 0.25, cy - r * 0.2, r * 0.25, '#4a4541', 0);
  }
  ctx.fillStyle = 'rgba(180,220,255,0.1)';
  for (const o of [0.15, 0.32]) {
    ctx.beginPath();
    ctx.moveTo(ix + iw * o, iy + ih);
    ctx.lineTo(ix + iw * o + 0.5, iy);
    ctx.lineTo(ix + iw * o + 0.72, iy);
    ctx.lineTo(ix + iw * o + 0.22, iy + ih);
    ctx.fill();
  }
  ctx.restore();
  const bars = Math.max(1, Math.round(w / 1.6) - 1);
  for (let i = 1; i <= bars; i++) rr(ctx, xa + (w * i) / (bars + 1) - 0.06, iy, 0.12, ih, 0.02, '#3a4250', 0.04);
}

function camScreen(ctx, x, top) {
  rr(ctx, x - 0.46, top - 1.74, 0.92, 0.72, 0.06, '#2a3440', 0.06);
  for (let i = 0; i < 4; i++) {
    const sx = x - 0.39 + (i % 2) * 0.4;
    const sy = top - 1.67 + Math.floor(i / 2) * 0.3;
    rr(ctx, sx, sy, 0.38, 0.26, 0.03, '#21412c', 0);
    ctx.fillStyle = 'rgba(155,227,122,0.55)';
    ctx.fillRect(sx + 0.04, sy + 0.17, 0.3, 0.03);
    ctx.fillRect(sx + 0.08 + hash(i, 2) * 0.18, sy + 0.08, 0.06, 0.09);
  }
  disc(ctx, x + 0.38, top - 1.68, 0.035, '#ff4b4b', 0);
}

/** A wall-mounted security camera above floor row `top`; its light blinks red while someone watches. */
export function securityCam(ctx, x, top, rec, t) {
  ctx.save();
  // Mount plate and arm.
  rr(ctx, x - 0.2, top - 1.94, 0.4, 0.26, 0.06, '#6b7682', 0.05);
  line(ctx, [x, top - 1.8, x, top - 1.42], INK, 0.17);
  line(ctx, [x, top - 1.8, x, top - 1.42], '#8d98a4', 0.08);
  // Housing tilted down at the corridor, with a sun hood and a dark lens.
  const y = top - 1.22;
  rr(ctx, x - 0.42, y - 0.24, 0.84, 0.46, 0.15, '#e3e8ed');
  rr(ctx, x - 0.36, y + 0.06, 0.72, 0.12, 0.05, '#c2cbd4', 0);
  rr(ctx, x - 0.48, y - 0.3, 0.96, 0.13, 0.06, '#9aa5b1', 0.05);
  disc(ctx, x, y + 0.02, 0.16, '#18212b');
  disc(ctx, x, y + 0.02, 0.09, '#2f5574', 0);
  disc(ctx, x - 0.035, y - 0.015, 0.032, 'rgba(210,240,255,0.95)', 0);
  // Status light.
  const on = rec && (t * 1.6) % 1 < 0.6;
  if (on) glow(ctx, x + 0.29, y - 0.08, 0.42, '255,59,48', 0.6);
  disc(ctx, x + 0.29, y - 0.08, 0.055, on ? '#ff3b30' : '#5a2626', 0.03);
  ctx.restore();
}

function breaker(ctx, x, top, hw, seed) {
  rr(ctx, x - hw, top - 1.84, hw * 2, 1.48, 0.06, '#8c9088', 0.06);
  rr(ctx, x - hw + 0.08, top - 1.76, hw * 2 - 0.16, 1.1, 0.04, '#6c7069', 0.035);
  const cols = Math.floor((hw * 2 - 0.2) / 0.22);
  const x0 = x - (cols * 0.22) / 2;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = x0 + c * 0.22 + 0.04;
      const sy = top - 1.68 + r * 0.44;
      const on = hash(seed + c, r) > 0.25;
      rr(ctx, sx, sy, 0.14, 0.3, 0.02, '#2b2f35', 0.025);
      rr(ctx, sx + 0.03, sy + (on ? 0.03 : 0.15), 0.08, 0.12, 0.01, on ? '#e9ecef' : '#e0443a', 0);
    }
  }
  hazard(ctx, x - hw + 0.08, top - 0.6, hw * 2 - 0.16, 0.14, 0.2);
}

/** LED positions along a breaker panel, for the live layer. */
function breakerLeds(x, top, hw, seed) {
  const cols = Math.floor((hw * 2 - 0.2) / 0.22);
  const x0 = x - (cols * 0.22) / 2;
  const colors = ['#5ee36a', '#5ee36a', '#f2c230', '#ff5a4a'];
  const out = [];
  for (let c = 0; c < cols; c++) out.push([x0 + c * 0.22 + 0.07, top - 0.8, seed * 31 + c, colors[Math.floor(hash(seed, c) * 4)]]);
  return out;
}

/** Glass capacitor column (Shields). */
function tube(ctx, x, top) {
  rr(ctx, x - 0.18, top - 1.8, 0.36, 1.46, 0.14, 'rgba(207,227,240,0.35)', 0.05);
  rr(ctx, x - 0.08, top - 1.72, 0.16, 1.3, 0.06, '#d9b93a', 0);
  rr(ctx, x - 0.23, top - 1.94, 0.46, 0.18, 0.04, '#59636f', 0.05);
  rr(ctx, x - 0.23, top - 0.4, 0.46, 0.18, 0.04, '#59636f', 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - 0.13, top - 1.7, 0.03, 1.2);
}

function o2Panel(ctx, x, top) {
  rr(ctx, x - 0.4, top - 1.8, 0.8, 1.06, 0.06, '#3c5444', 0.06);
  text(ctx, 'O2', x, top - 1.62, 0.2, '#c8f2a8');
  for (let i = 0; i < 3; i++) {
    const bx = x - 0.27 + i * 0.2;
    rr(ctx, bx, top - 1.46, 0.14, 0.62, 0.03, '#17261c', 0.03);
    const f = 0.35 + hash(i, 61) * 0.6;
    ctx.fillStyle = '#7ce38a';
    ctx.fillRect(bx + 0.02, top - 0.86 - 0.58 * f, 0.1, 0.58 * f);
  }
}

function valvePipe(ctx, x, top, th) {
  ctx.fillStyle = shade(th[2], 0.72);
  ctx.fillRect(x - 0.09, top - 2, 0.18, 1.82);
  line(ctx, [x - 0.09, top - 2, x - 0.09, top - 0.18], INK, 0.035, 'butt');
  line(ctx, [x + 0.09, top - 2, x + 0.09, top - 0.18], INK, 0.035, 'butt');
  ctx.fillStyle = shade(th[2], 1.25);
  ctx.fillRect(x - 0.06, top - 2, 0.04, 1.82);
  rr(ctx, x - 0.14, top - 0.34, 0.28, 0.14, 0.03, shade(th[2], 0.55), 0.04);
  const y = top - 1.12;
  disc(ctx, x, y, 0.25, null, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.11;
  ctx.stroke();
  ctx.strokeStyle = '#c94a3f';
  ctx.lineWidth = 0.06;
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + 0.3;
    line(ctx, [x - Math.cos(a) * 0.24, y - Math.sin(a) * 0.24, x + Math.cos(a) * 0.24, y + Math.sin(a) * 0.24], '#c94a3f', 0.045);
  }
  disc(ctx, x, y, 0.06, '#59636f', 0.03);
}

function picture(ctx, x, top) {
  rr(ctx, x - 1.1, top - 1.86, 2.2, 1.06, 0.05, '#b89a5a', 0.06);
  rr(ctx, x - 1.0, top - 1.77, 2.0, 0.88, 0.03, '#162238', 0.04);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 12; i++) ctx.fillRect(x - 0.95 + hash(i, 71) * 1.9, top - 1.72 + hash(71, i) * 0.78, 0.03, 0.03);
  const y = top - 1.33;
  disc(ctx, x + 0.62, top - 1.55, 0.14, '#ff8a5c', 0);
  // The Kestrel in profile.
  rr(ctx, x - 0.62, y - 0.13, 1.05, 0.26, 0.12, '#dfe6ec', 0.035);
  ctx.fillStyle = '#dfe6ec';
  ctx.beginPath();
  ctx.moveTo(x + 0.38, y - 0.12);
  ctx.lineTo(x + 0.7, y);
  ctx.lineTo(x + 0.38, y + 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.035;
  ctx.stroke();
  rr(ctx, x - 0.5, y - 0.27, 0.36, 0.14, 0.05, '#b8c3cc', 0.03);
  rr(ctx, x - 0.5, y + 0.13, 0.36, 0.14, 0.05, '#b8c3cc', 0.03);
  oval(ctx, x - 0.66, y, 0.07, 0.1, '#ff9a3c');
  rr(ctx, x + 0.12, y - 0.07, 0.2, 0.1, 0.05, '#7bd1ff', 0);
}

/** Jump seat folded against the wall. */
function foldSeat(ctx, x, top) {
  rr(ctx, x - 0.26, top - 1.9, 0.52, 0.26, 0.1, '#e8892f', 0.05);
  rr(ctx, x - 0.38, top - 1.58, 0.76, 0.9, 0.16, '#e8892f', 0.06);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(x - 0.34, top - 1.3, 0.68, 0.04);
  ctx.fillRect(x - 0.34, top - 1.02, 0.68, 0.04);
  for (const dx of [-0.17, 0.17]) line(ctx, [x + dx, top - 1.56, x + dx, top - 0.72], '#3b434e', 0.07, 'butt');
  rr(ctx, x - 0.25, top - 1.2, 0.5, 0.12, 0.03, '#c9ced4', 0.03);
  rr(ctx, x - 0.42, top - 0.7, 0.84, 0.32, 0.08, '#5b6672', 0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x - 0.34, top - 0.66, 0.68, 0.05);
}

// ---------- floor pieces ----------

function pallet(ctx, [x0, y0, x1, y1]) {
  const m = 0.24;
  rr(ctx, x0 - m, y0 - m + 0.08, x1 - x0 + m * 2, y1 - y0 + m * 2, 0.05, '#7d6440', 0.04);
  ctx.fillStyle = '#a4875a';
  for (let y = y0 - m + 0.16; y < y1 + m; y += 0.34) ctx.fillRect(x0 - m + 0.06, y, x1 - x0 + m * 2 - 0.12, 0.2);
}

function grate(ctx, x, y, w, h, base) {
  rr(ctx, x - w / 2, y - h / 2, w, h, 0.08, shade(base, 0.55), 0.05);
  ctx.fillStyle = shade(base, 0.32);
  for (let gx = x - w / 2 + 0.14; gx < x + w / 2 - 0.12; gx += 0.2) ctx.fillRect(gx, y - h / 2 + 0.12, 0.1, h - 0.24);
}

function zone(ctx, [x0, y0, x1, y1]) {
  ctx.setLineDash([0.5, 0.3]);
  ctx.strokeStyle = 'rgba(242,194,48,0.5)';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 0.1);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Hazard border around an obstacle, on the sides listed (t, b, l, r). */
function hazardFrame(ctx, [x0, y0, x1, y1], gap, w, sides) {
  const o = gap + w;
  if (sides.includes('t')) hazard(ctx, x0 - o, y0 - o, x1 - x0 + o * 2, w);
  if (sides.includes('b')) hazard(ctx, x0 - o, y1 + gap, x1 - x0 + o * 2, w);
  if (sides.includes('l')) hazard(ctx, x0 - o, y0 - gap, w, y1 - y0 + gap * 2);
  if (sides.includes('r')) hazard(ctx, x1 + gap, y0 - gap, w, y1 - y0 + gap * 2);
}

function conduit(ctx, pts) {
  line(ctx, pts, '#232c42', 0.42, 'butt');
  line(ctx, pts, '#1d6f9c', 0.24, 'butt');
  line(ctx, pts, 'rgba(155,232,255,0.5)', 0.07, 'butt');
}

/** Point at distance s along a polyline. */
function along(pts, s) {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dy = pts[i + 3] - pts[i + 1];
    const l = Math.hypot(dx, dy);
    if (s <= l) return [pts[i] + (dx * s) / l, pts[i + 1] + (dy * s) / l];
    s -= l;
  }
  return null;
}

function polyLength(pts) {
  let l = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) l += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return l;
}

function bounds(pts, pad) {
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

// Things on top of the cafeteria tables (above the table props, so drawn live).
function tableTop(ctx, x, y, i) {
  const a = hash(i, 13) * TAU;
  const tx = x + Math.cos(a) * 0.45;
  const ty = y + Math.sin(a) * 0.35;
  rr(ctx, tx - 0.46, ty - 0.3, 0.92, 0.6, 0.09, i % 2 ? '#5f8fb5' : '#d07a4a', 0.05);
  disc(ctx, tx - 0.12, ty, 0.21, '#f4f6f8', 0.035);
  oval(ctx, tx - 0.12, ty - 0.02, 0.12, 0.08, i % 2 ? '#e9b44c' : '#7cc46a');
  disc(ctx, tx + 0.25, ty - 0.06, 0.1, '#e9eef2', 0.03);
  disc(ctx, x - Math.cos(a) * 0.6, y - Math.sin(a) * 0.45, 0.14, '#e9eef2', 0.035);
  disc(ctx, x - Math.cos(a) * 0.6, y - Math.sin(a) * 0.45, 0.08, '#6b4a2e', 0);
}

// ---------- blocking decor props (listed in map.js PROPS) ----------

function shadowRect(ctx, x0, y0, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x0 + 0.1, y0 + 0.2, w, h);
}

function shadowCircle(ctx, x, y, r) {
  oval(ctx, x + 0.05, y + 0.22, r * 1.05, r * 0.6, 'rgba(0,0,0,0.22)');
}

/** Upright cylinder standing on the circle (x, y, r); returns the top center y. */
function cylinder(ctx, x, y, r, h, fill) {
  const ry = r * 0.42;
  const yb = y + 0.08;
  const yt = yb - h;
  ctx.beginPath();
  ctx.moveTo(x - r, yt);
  ctx.lineTo(x - r, yb);
  ctx.ellipse(x, yb, r, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, yt);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x - r * 0.65, yt, r * 0.25, h);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(x + r * 0.45, yt, r * 0.4, h);
  return yt;
}

const PROP_ART = {
  vending(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const top = y0 - 1.72;
    const body = p.color || '#c94a3f';
    shadowRect(ctx, x0, y0, w, y1 - y0);
    rr(ctx, x0, top, w, y1 - top, 0.1, body, 0.08);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x1 - 0.17, top + 0.1, 0.1, y1 - top - 0.2);
    rr(ctx, x0 + 0.1, top + 0.1, w - 0.2, 0.22, 0.05, shade(body, 1.35), 0.04);
    const gx = x0 + 0.12;
    const gy = top + 0.42;
    const gw = w * 0.6;
    rr(ctx, gx, gy, gw, 1.12, 0.05, '#1b2530', 0.05);
    const goods = ['#f5d90a', '#5ee36a', '#ff7b7b', '#7bd1ff', '#ffffff', '#ff9f43'];
    const cw = (gw - 0.16) / 3;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = goods[Math.floor(hash(r * 3 + c, x0 | 0) * goods.length)];
        ctx.fillRect(gx + 0.08 + c * cw, gy + 0.1 + r * 0.26, cw - 0.06, 0.15);
      }
      ctx.fillStyle = '#59636f';
      ctx.fillRect(gx + 0.05, gy + 0.26 + r * 0.26, gw - 0.1, 0.03);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(gx + 0.1, gy + 1.12);
    ctx.lineTo(gx + gw * 0.6, gy);
    ctx.lineTo(gx + gw * 0.85, gy);
    ctx.lineTo(gx + 0.35, gy + 1.12);
    ctx.fill();
    const bx = gx + gw + 0.07;
    const bw = x1 - 0.1 - bx;
    rr(ctx, bx, gy, bw, 0.24, 0.03, '#9be8ff', 0.03);
    for (let i = 0; i < 4; i++) rr(ctx, bx + 0.04, gy + 0.36 + i * 0.15, bw - 0.08, 0.09, 0.02, '#e4eaef', 0.025);
    rr(ctx, bx + bw / 2 - 0.03, gy + 0.98, 0.06, 0.12, 0.02, '#11161c', 0);
    rr(ctx, x0 + 0.14, y1 - 0.5, w * 0.6, 0.26, 0.04, '#11161c', 0.04);
  },

  plant(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    ctx.lineWidth = 0.05;
    const leaf = (lx, ly, rx, ry, rot, c) => oval(ctx, x + lx, y - r + ly, rx, ry, c, 0.05, rot);
    leaf(-0.3, -0.22, 0.34, 0.13, -0.6, '#3f9a45');
    leaf(0.3, -0.26, 0.34, 0.13, 0.6, '#3f9a45');
    leaf(-0.06, -0.5, 0.13, 0.34, -0.15, '#4fb256');
    leaf(0.12, -0.44, 0.12, 0.3, 0.35, '#56c05d');
    leaf(-0.16, -0.08, 0.3, 0.12, -0.25, '#56c05d');
    leaf(0.17, -0.1, 0.3, 0.12, 0.3, '#4fb256');
    ctx.fillStyle = '#c96f3f';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.85, y - r * 0.35);
    ctx.lineTo(x + r * 0.85, y - r * 0.35);
    ctx.lineTo(x + r * 0.62, y + r * 0.5);
    ctx.lineTo(x - r * 0.62, y + r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = INK;
    ctx.stroke();
    rr(ctx, x - r * 0.95, y - r * 0.5, r * 1.9, r * 0.3, 0.05, '#e08a55', 0.06);
  },

  barrel(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    const c = p.color || '#c9583a';
    const h = r * 1.15;
    const yt = cylinder(ctx, x, y, r, h, c);
    for (const f of [0.3, 0.7]) {
      ctx.beginPath();
      ctx.ellipse(x, yt + h * f, r, r * 0.42, 0, Math.PI, 0, true);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }
    oval(ctx, x, yt, r, r * 0.42, shade(c, 1.2), 0.07);
    oval(ctx, x, yt, r * 0.72, r * 0.28, null, 0.03);
    disc(ctx, x + r * 0.35, yt, r * 0.12, '#3b434d', 0.03);
  },

  tank(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    const c = p.color || '#59636f';
    const h = r * 1.3;
    const yt = cylinder(ctx, x, y, r, h, c);
    ctx.fillStyle = p.stripe || YELLOW;
    ctx.fillRect(x - r, yt + h * 0.45, r * 2, h * 0.16);
    line(ctx, [x - r, yt + h * 0.45, x + r, yt + h * 0.45], INK, 0.03, 'butt');
    ctx.beginPath();
    ctx.ellipse(x, yt, r, r * 0.75, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = shade(c, 1.2);
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = INK;
    ctx.stroke();
    rr(ctx, x - 0.07, yt - r * 0.75 - 0.08, 0.14, 0.12, 0.03, '#2b2f35', 0.04);
    if (p.label) text(ctx, p.label, x, yt + h * 0.2, 0.2, p.stripe || '#fff');
  },

  canisters(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    rr(ctx, x0, y0 + 0.05, w, h - 0.05, 0.06, '#3b434d', 0.07);
    const colors = ['#d6a93a', '#8f969c', '#c94a3f'];
    const ch = h / 3;
    for (let i = 0; i < 3; i++) {
      const cy = y0 + i * ch + 0.07;
      rr(ctx, x0 + 0.1, cy, w - 0.38, ch - 0.1, (ch - 0.1) / 2, colors[i], 0.05);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x0 + 0.3, cy + 0.06, w - 0.8, 0.05);
      rr(ctx, x1 - 0.32, cy + ch * 0.22, 0.18, ch * 0.4, 0.03, '#2b2f35', 0.04);
    }
  },

  iv(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    for (const a of [0.3, Math.PI - 0.3, Math.PI / 2]) line(ctx, [x, y, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5], INK, 0.07);
    line(ctx, [x, y, x, y - 1.55], INK, 0.11);
    line(ctx, [x, y, x, y - 1.55], '#c9d1d8', 0.06);
    line(ctx, [x - 0.18, y - 1.55, x + 0.18, y - 1.55], '#c9d1d8', 0.05);
    rr(ctx, x - 0.15, y - 1.52, 0.3, 0.42, 0.08, 'rgba(190,235,255,0.85)', 0.04);
    ctx.fillStyle = 'rgba(255,120,120,0.7)';
    ctx.fillRect(x - 0.1, y - 1.32, 0.2, 0.18);
    ctx.beginPath();
    ctx.moveTo(x, y - 1.1);
    ctx.quadraticCurveTo(x + 0.15, y - 0.6, x + 0.62, y - 0.42);
    ctx.strokeStyle = 'rgba(220,240,255,0.8)';
    ctx.lineWidth = 0.035;
    ctx.stroke();
  },

  chair(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const ex = x + Math.cos(a) * r * 0.85;
      const ey = y + 0.12 + Math.sin(a) * r * 0.45;
      line(ctx, [x, y + 0.12, ex, ey], INK, 0.06);
      disc(ctx, ex, ey, 0.05, '#2b2f35', 0.02);
    }
    oval(ctx, x, y - 0.04, r * 0.85, r * 0.5, '#3a4654', 0.06);
    rr(ctx, x - r * 0.72, y - 0.56, r * 1.44, 0.72, 0.16, '#2f3a47', 0.07);
    rr(ctx, x - r * 0.5, y - 0.48, r * 1.0, 0.18, 0.08, '#4b5a6a', 0);
  },

  shelf(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const top = y0 - 1.66;
    shadowRect(ctx, x0, y0, w, y1 - y0);
    rr(ctx, x0, top, w, y1 - top, 0.06, '#6a5a45', 0.08);
    rr(ctx, x0 + 0.08, top + 0.08, w - 0.16, y1 - top - 0.16, 0.03, '#4a3f33', 0);
    const levels = [top + 0.66, top + 1.32, y1 - 0.1];
    let k = 0;
    for (const ly of levels) {
      let x = x0 + 0.16;
      while (x < x1 - 0.35) {
        const h = hash(k++, x0 | 0);
        if (h < 0.5) {
          const bw = 0.38 + hash(k, 3) * 0.2;
          const bh = 0.32 + hash(k, 4) * 0.16;
          if (x + bw > x1 - 0.12) break;
          rr(ctx, x, ly - 0.06 - bh, bw, bh, 0.03, h < 0.25 ? '#c49a5c' : '#b0864c', 0.04);
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillRect(x + bw / 2 - 0.03, ly - 0.06 - bh, 0.06, bh);
          x += bw + 0.08;
        } else {
          const c = ['#5f8fb5', '#c94a3f', '#5ea86a', '#e9b44c'][Math.floor(hash(k, 5) * 4)];
          for (let i = 0; i < 3 && x < x1 - 0.3; i++) {
            rr(ctx, x, ly - 0.36, 0.16, 0.3, 0.04, c, 0.035);
            x += 0.2;
          }
          x += 0.08;
        }
      }
      rr(ctx, x0 + 0.06, ly - 0.07, w - 0.12, 0.1, 0.02, '#8a7556', 0.035);
    }
  },

  rack(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const top = y0 - 1.72;
    shadowRect(ctx, x0, y0, w, y1 - y0);
    rr(ctx, x0, top, w, y1 - top, 0.08, '#2b313a', 0.08);
    for (let i = 0; i < 5; i++) {
      const uy = top + 0.12 + i * 0.4;
      rr(ctx, x0 + 0.1, uy, w - 0.2, 0.32, 0.03, '#3b434e', 0.03);
      ctx.fillStyle = '#20252c';
      for (let s = 0; s < 4; s++) ctx.fillRect(x0 + w * 0.42 + s * 0.14, uy + 0.08, 0.08, 0.16);
    }
    ctx.fillStyle = 'rgba(122,210,255,0.25)';
    ctx.fillRect(x0 + 0.04, top + 0.1, 0.04, y1 - top - 0.2);
  },

  transformer(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    rr(ctx, x0, y0 - 0.3, w, h + 0.3, 0.08, '#7d8288', 0.08);
    rr(ctx, x0 + 0.06, y0 - 0.24, w - 0.12, 0.42, 0.05, '#9aa0a6', 0);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.18) ctx.fillRect(x, y0 + 0.3, 0.07, h - 0.4);
    for (let i = 0; i < 3; i++) disc(ctx, x0 + 0.35 + i * ((w - 0.7) / 2), y0 - 0.05, 0.11, '#c9b9a0', 0.04);
    rr(ctx, x0 + w / 2 - 0.26, y0 + 0.38, 0.52, 0.44, 0.04, YELLOW, 0.04);
    ctx.fillStyle = INK;
    const bx = x0 + w / 2;
    const by = y0 + 0.6;
    ctx.beginPath();
    ctx.moveTo(bx + 0.04, by - 0.17);
    ctx.lineTo(bx - 0.1, by + 0.02);
    ctx.lineTo(bx, by + 0.02);
    ctx.lineTo(bx - 0.05, by + 0.18);
    ctx.lineTo(bx + 0.11, by - 0.04);
    ctx.lineTo(bx + 0.01, by - 0.04);
    ctx.closePath();
    ctx.fill();
  },

  boxes(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    const box = (bx, by, bw, bh, c) => {
      rr(ctx, bx, by, bw, bh, 0.04, c, 0.06);
      rr(ctx, bx, by, bw, 0.2, 0.04, shade(c, 1.15), 0.04);
      ctx.fillStyle = 'rgba(240,230,200,0.55)';
      ctx.fillRect(bx + bw / 2 - 0.04, by, 0.08, bh);
    };
    box(x0, y0 - 0.1, w * 0.52, h * 0.6, '#b0864c');
    box(x0 + w * 0.55, y0 - 0.05, w * 0.45, h * 0.55, '#c49a5c');
    box(x0 + w * 0.18, y0 + h * 0.42, w * 0.6, h * 0.58, '#c49a5c');
  },

  bin(ctx, p) {
    const [x, y, r] = p.circle;
    shadowCircle(ctx, x, y, r);
    const h = r * 1.2;
    const yt = cylinder(ctx, x, y, r * 0.9, h, '#7c8794');
    oval(ctx, x, yt, r, r * 0.42, '#a7b2bc', 0.06);
    oval(ctx, x, yt, r * 0.5, r * 0.16, '#2b2f35');
    ctx.fillStyle = '#5ea86a';
    ctx.fillRect(x - r * 0.5, yt + h * 0.4, r, h * 0.22);
  },

  bags(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    // Duffel bags.
    const bag = (cx, cy, bw, bh, c) => {
      ctx.beginPath();
      ctx.arc(cx, cy - bh / 2 + 0.04, bw * 0.16, Math.PI, 0);
      ctx.lineWidth = 0.09;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = shade(c, 0.7);
      ctx.stroke();
      rr(ctx, cx - bw / 2, cy - bh / 2, bw, bh, bh * 0.45, c, 0.07);
      ctx.fillStyle = shade(c, 0.8);
      for (const dx of [-0.25, 0.25]) ctx.fillRect(cx + dx * bw - 0.05, cy - bh / 2 + 0.03, 0.1, bh - 0.06);
      line(ctx, [cx - bw * 0.36, cy - bh * 0.12, cx + bw * 0.36, cy - bh * 0.12], 'rgba(0,0,0,0.35)', 0.035);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(cx - bw * 0.3, cy - bh * 0.36, bw * 0.6, 0.06);
    };
    bag(x0 + w * 0.3, y0 + h * 0.42, w * 0.6, h * 0.78, '#3f8a8f');
    bag(x0 + w * 0.65, y0 + h * 0.58, w * 0.66, h * 0.8, '#e0702f');
  },

  /** Food counter along the cafeteria's east wall. */
  counter(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    rr(ctx, x0, y0 - 0.25, w, h + 0.25, 0.08, '#6b7784', 0.08);
    rr(ctx, x0 - 0.04, y0 - 0.3, w + 0.04, h - 0.02, 0.08, '#d8e0e6', 0.07);
    for (let i = 0; i < 3; i++) rr(ctx, x0 + 0.14, y0 - 0.12 - i * 0.07, w - 0.36, 0.5, 0.06, ['#5f8fb5', '#d07a4a', '#5f8fb5'][i], 0.04);
    const px = x0 + w / 2 - 0.05;
    const py = y0 + 1.1;
    disc(ctx, px, py, 0.34, '#8f9aa6', 0.06);
    disc(ctx, px, py, 0.26, '#e9b44c', 0.03);
    line(ctx, [px + 0.05, py - 0.02, px + 0.42, py - 0.32], '#59636f', 0.06);
    rr(ctx, x0 + 0.12, y0 + 1.7, w - 0.32, 0.8, 0.06, '#3b434e', 0.06);
    rr(ctx, x0 + 0.22, y0 + 1.8, w - 0.52, 0.28, 0.03, '#59636f', 0);
    disc(ctx, x0 + w - 0.34, y0 + 1.92, 0.05, '#ff5a4a', 0);
    disc(ctx, x0 + w / 2 - 0.1, y0 + 2.32, 0.11, '#e9eef2', 0.03);
    for (let i = 0; i < 3; i++) disc(ctx, x0 + 0.3 + i * 0.26, y1 - 0.62, 0.1, '#e9eef2', 0.03);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x0 + 0.04, y1 - 0.3, w - 0.08, 0.06);
  },

  /** Medical trolley. */
  cart(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    for (const [wx, wy] of [
      [x0 + 0.1, y1 - 0.02],
      [x1 - 0.1, y1 - 0.02],
    ])
      disc(ctx, wx, wy, 0.07, '#2b2f35', 0.03);
    rr(ctx, x0 + 0.04, y1 - 0.42, w - 0.08, 0.32, 0.04, '#aab4bd', 0.05);
    rr(ctx, x0, y0 - 0.25, w, h - 0.15, 0.08, '#e9eef2', 0.07);
    rr(ctx, x0 + 0.08, y0 - 0.17, w - 0.16, h - 0.31, 0.05, '#d3dce3', 0);
    rr(ctx, x0 + 0.14, y0 - 0.08, 0.5, 0.3, 0.12, '#b8c3cc', 0.04);
    for (let i = 0; i < 3; i++) rr(ctx, x0 + 0.16 + i * 0.18, y0 + 0.36, 0.12, 0.26, 0.03, ['#7bd1ff', '#ff7b7b', '#9bff9b'][i], 0.03);
    disc(ctx, x0 + w / 2, y1 - 0.66, 0.13, '#ffffff', 0.03);
    disc(ctx, x0 + w / 2, y1 - 0.66, 0.04, '#d3dce3', 0);
  },

  /** Comms radio desk: transceiver, microphone, headset and a waveform screen. */
  radio(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    rr(ctx, x0, y0 - 0.2, w, h + 0.2, 0.08, '#3b434e', 0.08);
    rr(ctx, x0, y0 - 0.2, w, h - 0.12, 0.08, '#59636f', 0.06);
    rr(ctx, x0 + 0.18, y0 - 0.3, 1.3, 0.62, 0.05, '#2b313a', 0.06);
    rr(ctx, x0 + 0.28, y0 - 0.22, 0.6, 0.2, 0.03, '#7ad2ff', 0.03);
    disc(ctx, x0 + 1.12, y0 - 0.1, 0.12, '#c9ced4', 0.04);
    disc(ctx, x0 + 1.34, y0 - 0.1, 0.08, '#c9ced4', 0.04);
    for (let i = 0; i < 5; i++) disc(ctx, x0 + 0.32 + i * 0.12, y0 + 0.14, 0.03, '#11161c', 0);
    disc(ctx, x0 + 1.95, y0 + 0.22, 0.13, '#2b2f35', 0.04);
    line(ctx, [x0 + 1.95, y0 + 0.2, x0 + 2.05, y0 - 0.15], '#2b2f35', 0.05);
    oval(ctx, x0 + 2.07, y0 - 0.22, 0.08, 0.11, '#8f9aa6', 0.04);
    ctx.beginPath();
    ctx.arc(x0 + 2.55, y0 + 0.22, 0.24, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = INK;
    ctx.stroke();
    oval(ctx, x0 + 2.32, y0 + 0.24, 0.07, 0.1, '#e0702f', 0.035);
    oval(ctx, x0 + 2.78, y0 + 0.24, 0.07, 0.1, '#e0702f', 0.035);
    rr(ctx, x1 - 1.0, y0 - 0.32, 0.86, 0.56, 0.05, '#1b2530', 0.06);
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = x1 - 0.94 + i * 0.046;
      const y = y0 - 0.04 + Math.sin(i * 1.3) * 0.12 * Math.sin(i * 0.4);
      ctx[i ? 'lineTo' : 'moveTo'](x, y);
    }
    ctx.strokeStyle = '#7ad2ff';
    ctx.lineWidth = 0.03;
    ctx.stroke();
  },

  ammo(ctx, p) {
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    shadowRect(ctx, x0, y0, w, h);
    for (let i = 0; i < 2; i++) {
      const bx = x0 + i * (w / 2) + 0.03;
      const bw = w / 2 - 0.06;
      rr(ctx, bx, y0 - 0.15, bw, h + 0.15, 0.06, '#5f6b3e', 0.07);
      rr(ctx, bx, y0 - 0.15, bw, 0.32, 0.06, '#778450', 0.05);
      hazard(ctx, bx + 0.1, y0 + h * 0.5, bw - 0.2, 0.14, 0.2);
      rr(ctx, bx + bw / 2 - 0.08, y0 + 0.18, 0.16, 0.12, 0.02, '#c9ced4', 0.03);
    }
  },
};

/** Draw a blocking prop whose kind belongs to decor. Returns true if handled. */
export function drawDecorProp(ctx, p) {
  const draw = PROP_ART[p.kind];
  if (!draw) return false;
  ctx.save();
  draw(ctx, p);
  ctx.restore();
  return true;
}

// ---------- layout ----------

// Painted direction signs in the Kestrel's corridors: [x, y, label, arrow].
const HALL_SIGNS = [
  [27.5, 14, 'PORT ENGINE', 'l'],
  [35, 13.7, 'MEDBAY', 'd'],
  [44.3, 14, 'CAFETERIA', 'r'],
  [16, 34.3, 'REACTOR', 'l'],
  [16, 41.7, 'SECURITY', 'r'],
  [25.8, 60, 'ENGINE', 'l'],
  [40, 60.3, 'ELECTRICAL', 'u'],
  [44.5, 60, 'STORAGE', 'r'],
  [60, 27, 'CAFETERIA', 'u'],
  [60, 34, 'ADMIN', 'r'],
  [60, 46, 'STORAGE', 'd'],
  [80.5, 11, 'WEAPONS', 'r'],
  [94, 20.5, 'WEAPONS', 'u'],
  [94, 24, 'O2', 'l'],
  [98.6, 38, 'BRIDGE', 'r'],
  [112, 50.5, 'BRIDGE', 'u'],
  [107.6, 59, 'SHIELDS', 'l'],
  [70.5, 64, 'STORAGE', 'l'],
  [80, 63.7, 'COMMS', 'd'],
  [87.8, 64, 'SHIELDS', 'r'],
];

function build(map) {
  const items = []; // static: { b: [x0, y0, x1, y1], d(ctx) }
  const live = []; // animated: { b, d(ctx, t) }
  const { W, H, face, floor } = map;
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor[y * W + x];
  const faceAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? face[y * W + x] : 0);
  const consoles = Object.values(map.stations).filter((s) => s.wall);
  /** Both face rows stand over [xa, xb) above floor row `top`, with no wall console in the way. */
  const wallFree = (top, xa, xb) => {
    for (let x = Math.floor(xa); x < Math.ceil(xb); x++) if (faceAt(x, top - 1) !== 1 || faceAt(x, top - 2) !== 2) return false;
    return !consoles.some((s) => {
      const hw = s.look === 'sample' ? 0.72 : 0.52;
      return Math.floor(s.y) === top && s.x + hw > xa && s.x - hw < xb;
    });
  };
  const d = {
    floor: (b, fn) => items.push({ b, d: fn }),
    live: (b, fn) => live.push({ b, d: fn }),
    /** A fitting centered at x on the wall above floor row `top`; skipped where the wall is busy. */
    wall(top, x, hw, fn) {
      if (!wallFree(top, x - hw, x + hw)) return false;
      items.push({ b: [x - hw - 0.6, top - 2, x + hw + 0.6, top + 0.1], d: (ctx) => fn(ctx, x, top) });
      return true;
    },
    pool(x, y, r, a, rgb) {
      items.push({ b: [x - r, y - r * 0.6, x + r, y + r * 0.6], d: (ctx) => pool(ctx, x, y, r, a, rgb) });
    },
    lamp(top, x, r = 2.2) {
      if (d.wall(top, x, 0.3, lamp)) d.pool(x, top + 1.5, r, 0.12);
    },
    sign(top, x, label, th) {
      d.wall(top, x, signWidth(label) / 2, (ctx) => sign(ctx, x, top, label, th));
    },
    pipes(top, xa, xb, th) {
      if (wallFree(top, xa, xb)) items.push({ b: [xa, top - 2, xb, top], d: (ctx) => pipes(ctx, xa, xb, top, th) });
    },
  };

  // Halls: ceiling pipes and lamps on north walls, lights along the long ones, maintenance hatches.
  const signs = map.id === 'kestrel' ? HALL_SIGNS : [];
  const keepClear = [
    ...signs.map(([x, y]) => [x, y, 2.2]),
    ...Object.values(map.vents).map((v) => [v.x, v.y, 1.6]),
    ...map.doors.map((dr) => [(dr.rect[0] + dr.rect[2]) / 2, (dr.rect[1] + dr.rect[3]) / 2, 2.6]),
  ];
  const clear = (x, y) => keepClear.every(([cx, cy, r]) => Math.abs(cx - x) > r || Math.abs(cy - y) > r * 0.8);
  const hallTh = THEMES.hall;
  for (const [x0, y0, x1, y1] of map.halls) {
    const horiz = x1 - x0 > y1 - y0;
    if (horiz) {
      let start = null;
      for (let x = x0; x <= x1; x++) {
        const ok = x < x1 && wallFree(y0, x, x + 1);
        if (ok && start === null) start = x;
        if (!ok && start !== null) {
          if (x - start >= 2) d.pipes(y0, start + 0.05, x - 0.05, hallTh);
          start = null;
        }
      }
      const len = x1 - x0;
      if (len >= 5) {
        const n = Math.max(1, Math.round(len / 7));
        for (let i = 0; i < n; i++) d.lamp(y0, x0 + ((i + 0.5) * len) / n, 2.0);
      }
      for (let x = x0 + 4.5; x < x1 - 2; x += 9) {
        const y = y1 - 0.9;
        if (clear(x, y)) d.floor([x - 0.5, y - 0.5, x + 0.5, y + 0.5], (ctx) => hatch(ctx, x, y, hallTh[0]));
      }
    } else if (y1 - y0 >= 6) {
      const cx = (x0 + x1) / 2;
      for (let y = y0 + 3; y < y1 - 2; y += 6) d.pool(cx, y, 2.0, 0.08);
      for (let y = y0 + 6; y < y1 - 2; y += 9) {
        const x = x1 - 0.9;
        if (clear(x, y)) d.floor([x - 0.5, y - 0.5, x + 0.5, y + 0.5], (ctx) => hatch(ctx, x, y, hallTh[0]));
      }
      // Guide lights along the walls, with a pulse running down the corridor.
      const dots = [];
      for (const [x, outside] of [
        [x0 + 0.22, x0 - 1],
        [x1 - 0.22, x1],
      ]) {
        for (let y = y0 + 0.75; y < y1; y += 1.5) {
          const inDoor = map.doors.some(({ rect: r }) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
          if (!isFloor(outside, Math.floor(y)) && !inDoor) dots.push([x, y]);
        }
      }
      d.floor([x0, y0, x1, y1], (ctx) => {
        for (const [x, y] of dots) rr(ctx, x - 0.08, y - 0.08, 0.16, 0.16, 0.04, '#26323c', 0);
      });
      d.live([x0, y0, x1, y1], (ctx, t) => {
        for (const [x, y] of dots) {
          const a = Math.max(0, Math.sin((y - t * 5) * 0.35)) ** 4;
          ctx.fillStyle = `rgba(122,210,255,${0.25 + a * 0.7})`;
          ctx.fillRect(x - 0.05, y - 0.05, 0.1, 0.1);
        }
      });
    }
  }
  for (const [x, y, label, dir] of signs) d.floor([x - 2.6, y - 1, x + 2.6, y + 1], (ctx) => floorSign(ctx, x, y, label, dir));

  for (const rm of map.rooms) ROOM_DECOR[rm.id]?.(d, rm.rect, THEMES[rm.theme], map);
  return { items, live };
}

// Per-room furnishing. Coordinates are the Kestrel's and the dropship's (see map.js).
const ROOM_DECOR = {
  cafeteria(d, [, top], th) {
    d.floor([58.5, 8.5, 66.5, 16.5], (ctx) => {
      ctx.lineWidth = 0.26;
      ctx.strokeStyle = shade(th[0], 0.9);
      ctx.beginPath();
      ctx.arc(62.5, 12.5, 3.05, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = shade(th[0], 0.8);
      ctx.beginPath();
      ctx.arc(62.5, 12.5, 3.4, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = shade(th[0], 0.82);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        disc(ctx, 62.5 + Math.cos(a) * 3.4, 12.5 + Math.sin(a) * 3.4, 0.07, shade(th[0], 0.8), 0);
      }
    });
    d.pool(62.5, 12.8, 3.8, 0.1);
    const tables = [
      [55, 7.5],
      [70, 7.5],
      [55, 18.5],
      [70, 18.5],
    ];
    for (const [x, y] of tables) d.pool(x, y + 0.3, 2.4, 0.1);
    d.wall(top, 51.2, 0.32, clock);
    d.lamp(top, 59.6);
    d.sign(top, 62.5, 'CAFETERIA', th);
    d.lamp(top, 65.4);
    d.wall(top, 68.2, 0.42, (ctx, x, t) => poster(ctx, x, t, 0));
    d.wall(top, 74.3, 0.24, extinguisher);
    tables.forEach(([x, y], i) => d.live([x - 1.3, y - 1.3, x + 1.3, y + 1.3], (ctx) => tableTop(ctx, x, y, i)));
  },

  medbay(d, [, top], th) {
    d.floor([30.2, 23.2, 32.6, 25.6], (ctx) => {
      disc(ctx, 31.4, 24.4, 1.0, 'rgba(255,255,255,0.28)', 0);
      ctx.fillStyle = 'rgba(224,68,58,0.6)';
      ctx.fillRect(31.4 - 0.22, 24.4 - 0.66, 0.44, 1.32);
      ctx.fillRect(31.4 - 0.66, 24.4 - 0.22, 1.32, 0.44);
    });
    d.sign(top, 29.15, 'MEDBAY', th);
    d.lamp(top, 32.3);
    d.wall(top, 39.0, 0.44, cabinet);
    if (d.wall(top, 40.75, 0.4, heartMonitor)) {
      d.live([40.3, top - 1.8, 41.2, top - 1.1], (ctx, t) => {
        const x = 40.75;
        const y = top - 1.46;
        const k = (t * 0.9) % 1;
        const px = -0.28 + k * 0.56;
        let py = 0;
        for (let i = 0; i + 3 < ECG.length; i += 2) {
          if (px >= ECG[i] && px <= ECG[i + 2]) py = ECG[i + 1] + ((px - ECG[i]) / (ECG[i + 2] - ECG[i])) * (ECG[i + 3] - ECG[i + 1]);
        }
        glow(ctx, x + px, y + py, 0.12, '94,240,138', 0.8);
        disc(ctx, x + px, y + py, 0.03, '#d8ffe4', 0);
      });
    }
  },

  portEngine(d, rect, th) {
    engineRoom(d, rect, th, {
      engine: [7, 9, 12.5, 17],
      pipes: [6.2, 17.6],
      gauges: [9.0, 11.6],
      sign: [14.6, radiation],
      lamp: 21.2,
      grate: [17.3, 14.5],
      stains: [
        [10.4, 18.7, 0.7],
        [14.6, 9.3, 0.5],
      ],
      cable: [12.6, 11.2, 16.2, 11.2, 16.2, 7.4, 19, 7.4, 19, 6.1],
    });
  },

  starboardEngine(d, rect, th) {
    engineRoom(d, rect, th, {
      engine: [7, 57, 12.5, 65],
      pipes: [6.2, 13.6],
      gauges: [8.6, 11.2],
      sign: [20.7, warnSign],
      grate: [17.3, 62.4],
      stains: [
        [10.6, 66.8, 0.6],
        [15.2, 62.8, 0.5],
      ],
      cable: [12.6, 59.2, 16.4, 59.2, 16.4, 55.4, 19, 55.4, 19, 54.1],
    });
  },

  reactor(d, [x0, top, x1, y1], th) {
    const cx = 6;
    const cy = 38.5;
    const lines = [
      [cx, cy, 3, 35.5, 3, 31.2],
      [cx, cy, 3, 41.5, 3, 45.8],
      [cx, cy, 8.5, 36, 8.5, 31.2],
      [cx, cy, 11.95, 38.5],
    ];
    d.floor([cx - 3.6, cy - 3.6, cx + 3.6, cy + 3.6], (ctx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, TAU);
      ctx.arc(cx, cy, 2.95, 0, TAU, true);
      ctx.fillStyle = '#2e3a55';
      ctx.fill();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = INK;
      ctx.stroke();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        line(ctx, [cx + Math.cos(a) * 3.02, cy + Math.sin(a) * 3.02, cx + Math.cos(a) * 3.33, cy + Math.sin(a) * 3.33], '#4f6083', 0.05);
      }
    });
    for (const pts of lines) d.floor(bounds(pts, 0.3), (ctx) => conduit(ctx, pts));
    d.wall(top, 1.7, 0.3, (ctx, x, t) => grille(ctx, x, t, th));
    d.wall(top, 5.6, 0.34, radiation);
    d.pipes(top, 9.3, 11.95, th);
    d.wall(top, 10.6, 0.22, (ctx, x, t) => gauge(ctx, x, t, 5));
    const room = [x0, top, x1, y1];
    d.live([cx - 4.4, cy - 4.4, cx + 4.4, cy + 4.4], (ctx, t) => {
      const p = 0.5 + 0.5 * Math.sin(t * 2.2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(room[0], room[1], room[2] - room[0], room[3] - room[1]);
      ctx.clip();
      const g = ctx.createRadialGradient(cx, cy, 2.4, cx, cy, 4.4);
      g.addColorStop(0, `rgba(127,211,255,${0.18 + 0.12 * p})`);
      g.addColorStop(1, 'rgba(127,211,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 4.4, cy - 4.4, 8.8, 8.8);
      const k = (t * 0.45) % 1;
      ctx.strokeStyle = `rgba(155,232,255,${0.45 * (1 - k)})`;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.7 + k * 1.6, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#c8f4ff';
      for (const pts of lines) {
        const len = polyLength(pts);
        for (let s = (t * 1.4) % 0.9; s < len; s += 0.9) {
          const q = along(pts, s);
          if (q && Math.hypot(q[0] - cx, q[1] - cy) > 2.75) disc(ctx, q[0], q[1], 0.06, '#c8f4ff', 0);
        }
      }
      ctx.restore();
    });
  },

  security(d, [, top], th) {
    d.floor([23.2, 37.9, 29.7, 42.6], (ctx) => rug(ctx, [23.2, 37.9, 29.7, 42.6], '#56677a', 'rgba(155,227,122,0.35)'));
    d.pool(26.75, 36.9, 2.8, 0.09, '155,227,122');
    d.lamp(top, 22.6);
    d.sign(top, 25.0, 'SECURITY', th);
    d.wall(top, 27.4, 0.46, camScreen);
  },

  electrical(d, [, top], th) {
    const wires = [
      [[33.2, 41.05, 33.2, 41.6, 32.6, 42.2, 32.6, 49.25], '#e0443a'],
      [[37.5, 41.05, 37.5, 43.2, 41.6, 43.2, 41.6, 45.05], '#2f6fe0'],
      [[44, 45.8, 44.8, 45.8, 44.8, 48.05], YELLOW],
    ];
    for (const [pts, c] of wires) d.floor(bounds(pts, 0.2), (ctx) => cable(ctx, pts, c));
    d.floor([37.4, 47.2, 39.4, 48.6], (ctx) => stain(ctx, 38.4, 47.9, 0.6, 21, '20,18,16', 0.22));
    if (d.wall(top, 33.2, 0.62, (ctx, x, t) => breaker(ctx, x, t, 0.62, 1)))
      d.live([32.5, top - 1, 33.9, top - 0.6], ledBlink(breakerLeds(33.2, top, 0.62, 1)));
    if (d.wall(top, 37.5, 0.44, (ctx, x, t) => breaker(ctx, x, t, 0.44, 2)))
      d.live([37, top - 1, 38, top - 0.6], ledBlink(breakerLeds(37.5, top, 0.44, 2)));
    d.sign(top, 42.0, 'ELECTRICAL', th);
    // Now and then the transformer sparks.
    d.live([32, 48, 34.2, 50], (ctx, t) => {
      const n = Math.floor(t * 1.5);
      const k = (t * 1.5) % 1;
      if (hash(n, 77) > 0.22 || k > 0.3) return;
      const x = 32.4 + hash(n, 78) * 1.3;
      const y = 49.0;
      glow(ctx, x, y, 0.6, '255,240,150', 0.6 * (1 - k / 0.3));
      line(ctx, [x, y, x + 0.12, y - 0.15, x - 0.02, y - 0.25, x + 0.1, y - 0.42], '#fff6c8', 0.04);
    });
  },

  storage(d, [, top], th) {
    d.floor([50, 52, 57, 64.4], (ctx) => zone(ctx, [50.3, 52.3, 56.6, 64.0]));
    d.floor([58, 64, 63.6, 68.6], (ctx) => zone(ctx, [58.4, 64.4, 63.2, 68.2]));
    for (const r of [
      [51, 53, 54, 55.5],
      [59, 65, 62.5, 67.5],
      [53, 61, 55.5, 63],
    ])
      d.floor([r[0] - 0.3, r[1] - 0.3, r[2] + 0.3, r[3] + 0.4], (ctx) => pallet(ctx, r));
    d.floor([59, 53.9, 62, 56.2], (ctx) => {
      pallet(ctx, [59.4, 54.4, 61.4, 55.8]);
      pallet(ctx, [59.5, 54.22, 61.5, 55.62]);
    });
    d.floor([64.2, 57.5, 65.6, 58.5], (ctx) => stain(ctx, 64.9, 58.0, 0.45, 31, '150,40,30', 0.25));
    d.floor([55.5, 66.5, 57.5, 67.5], (ctx) => stain(ctx, 56.5, 67.0, 0.5, 33));
    d.wall(top, 49.2, 0.24, extinguisher);
    d.lamp(top, 57.5);
    d.sign(top, 63.6, 'STORAGE', th);
  },

  admin(d, [, top], th) {
    d.floor([68.3, 34.3, 75.7, 38.7], (ctx) => rug(ctx, [68.3, 34.3, 75.7, 38.7], '#6f8a6c', 'rgba(227,242,200,0.4)'));
    d.pool(72, 36.5, 4.2, 0.07, '124,242,154');
    d.lamp(top, 69.6);
    d.wall(top, 71.8, 1.12, picture);
    d.wall(top, 73.9, 0.32, clock);
    d.wall(top, 77.0, 0.32, (ctx, x, t) => grille(ctx, x, t, th));
  },

  comms(d, [x0, top, x1, y1], th, map) {
    d.floor([x0, top, x1, y1], (ctx) => {
      for (let y = top; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x + 0.1, y + 0.1, 1.8, 1.8);
          ctx.fillStyle = 'rgba(0,0,0,0.13)';
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x + 0.55 + i * 0.4, y + 0.55 + j * 0.4, 0.08, 0.08);
        }
      }
    });
    const wires = [
      [[73.9, 69.75, 73.9, 72.6, 82.4, 72.6], '#7ad2ff'],
      [[83.05, 69.75, 83.05, 72.1], YELLOW],
    ];
    for (const [pts, c] of wires) d.floor(bounds(pts, 0.2), (ctx) => cable(ctx, pts, c));
    d.pool(80, 71.8, 2.8, 0.08, '122,210,255');
    d.lamp(top, 77.1);
    d.wall(top, 84.45, 0.3, (ctx, x, t) => speaker(ctx, x, t, th));
    for (const p of map.props) {
      if (p.kind !== 'rack') continue;
      const [rx0, ry0, rx1] = p.rect;
      const leds = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 2; j++) {
          leds.push([
            rx0 + 0.2 + j * 0.13,
            ry0 - 1.72 + 0.24 + i * 0.4,
            i * 7 + j + (rx0 | 0),
            ['#5ee36a', '#7ad2ff', '#f2c230'][(i + j) % 3],
          ]);
        }
      }
      d.live([rx0, ry0 - 1.8, rx1, ry0], ledBlink(leds));
    }
  },

  shields(d, [, top], th) {
    d.floor([93.2, 55.2, 102.8, 64.8], (ctx) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(98, 60, 4.6, 0, TAU);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,227,107,0.2)';
      ctx.lineWidth = 0.05;
      const s = 0.6;
      const hx = s * Math.sqrt(3);
      for (let row = -9; row <= 9; row++) {
        for (let col = -6; col <= 6; col++) {
          const x = 98 + col * hx + (row % 2 ? hx / 2 : 0);
          const y = 60 + row * s * 1.5;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i + Math.PI / 6;
            ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,227,107,0.35)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(98, 60, 4.6, 0, TAU);
      ctx.stroke();
    });
    d.live([93, 55, 103, 65], (ctx, t) => {
      const k = (t * 0.55) % 1;
      ctx.strokeStyle = `rgba(255,227,107,${0.4 * (1 - k)})`;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(98, 60, 1.75 + k * 2.8, 0, TAU);
      ctx.stroke();
    });
    d.wall(top, 92.6, 0.24, extinguisher);
    for (const x of [94.0, 96.0]) {
      if (!d.wall(top, x, 0.24, tube)) continue;
      d.live([x - 0.8, top - 2, x + 0.8, top], (ctx, t) => {
        const a = 0.3 + 0.3 * Math.sin(t * 3 + x);
        rr(ctx, x - 0.08, top - 1.72, 0.16, 1.3, 0.06, `rgba(255,250,210,${a})`, 0);
        glow(ctx, x, top - 1.08, 0.75, '255,227,107', a * 0.4);
      });
    }
    d.sign(top, 99.4, 'SHIELDS', th);
    d.lamp(top, 103.3);
  },

  o2(d, [, top], th) {
    d.floor([81, 22.6, 90, 32], (ctx) => {
      stain(ctx, 83.5, 24.9, 0.55, 41, '90,60,30', 0.22);
      stain(ctx, 88.0, 31.7, 0.5, 43, '90,60,30', 0.2);
      for (let i = 0; i < 9; i++) {
        const nearA = i < 5;
        const x = nearA ? 82.2 + hash(i, 51) * 2.8 : 86.6 + hash(i, 51) * 2.8;
        const y = nearA ? 24.7 + hash(51, i) * 0.8 : 29.3 + hash(51, i) * 0.5;
        oval(ctx, x, y, 0.13, 0.06, i % 2 ? '#3f9a45' : '#6cc46a', 0.025, hash(i, 52) * Math.PI);
      }
    });
    d.pool(85.5, 27, 3.2, 0.08, '200,242,168');
    d.wall(top, 82.3, 0.4, o2Panel);
    d.wall(top, 86.5, 0.3, (ctx, x, t) => valvePipe(ctx, x, t, th));
    d.lamp(top, 89.6);
  },

  weapons(d, [, top], th) {
    d.floor([89.8, 6.3, 96.2, 12.7], (ctx) => {
      ctx.strokeStyle = 'rgba(255,138,92,0.35)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(93, 9.5, 2.6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([0.3, 0.2]);
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(93, 9.5, 2.0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        line(
          ctx,
          [93 + Math.cos(a) * 2.3, 9.5 + Math.sin(a) * 2.3, 93 + Math.cos(a) * 3.1, 9.5 + Math.sin(a) * 3.1],
          'rgba(255,138,92,0.4)',
          0.08,
        );
      }
    });
    d.wall(top, 86.8, 0.24, extinguisher);
    d.lamp(top, 90.3);
    d.wall(top, 93.4, 2.2, (ctx, x, t) => windowPane(ctx, 91.2, 95.6, t, 7));
    d.lamp(top, 98.2);
  },

  bridge(d, [, top, , y1], th) {
    d.floor([106, 36.5, 115.6, 39.5], (ctx) => {
      rr(ctx, 106, 36.5, 9.6, 3, 0.12, '#3d5878', 0);
      ctx.fillStyle = 'rgba(199,236,255,0.45)';
      ctx.fillRect(106, 36.75, 9.35, 0.08);
      ctx.fillRect(106, 39.17, 9.35, 0.08);
      ctx.fillStyle = 'rgba(199,236,255,0.18)';
      for (let x = 107; x < 115; x += 1.5) {
        ctx.beginPath();
        ctx.moveTo(x, 37.4);
        ctx.lineTo(x + 0.45, 38);
        ctx.lineTo(x, 38.6);
        ctx.lineTo(x + 0.2, 38);
        ctx.closePath();
        ctx.fill();
      }
    });
    d.pool(116.5, 37, 3, 0.09, '97,198,255');
    // The nose window, in the hull past the pilot console.
    d.floor([119, top + 1.5, 120.1, y1 - 1.5], (ctx) => {
      const y = top + 2.2;
      const h = y1 - top - 4.4;
      rr(ctx, 119.1, y, 0.8, h, 0.3, '#06101f', 0.06);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 26; i++) ctx.fillRect(119.15 + hash(i, 81) * 0.7, y + hash(81, i) * h, 0.04, 0.04);
      disc(ctx, 120.3, y + h * 0.7, 0.95, '#3d6fa8', 0);
      disc(ctx, 120.42, y + h * 0.68, 0.82, '#5a8fd0', 0);
      ctx.fillStyle = 'rgba(180,220,255,0.12)';
      ctx.fillRect(119.25, y, 0.12, h);
      ctx.restore();
    });
    d.lamp(top, 107.0);
    d.sign(top, 110.25, 'BRIDGE', th);
    d.wall(top, 114.5, 1.3, (ctx, x, t) => starChart(ctx, x, t, 2.6));
    d.lamp(top, 118.3);
  },

  dropship(d, [x0, top, x1, y1], th, map) {
    d.floor([15.6, 10.1, 23.4, 17.9], (ctx) => {
      ctx.lineWidth = 0.24;
      ctx.strokeStyle = shade(th[0], 0.9);
      ctx.beginPath();
      ctx.arc(19.5, 14, 3.3, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,179,71,0.4)';
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(19.5, 14);
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(3.75, -0.25);
        ctx.lineTo(3.45, 0);
        ctx.lineTo(3.75, 0.25);
        ctx.lineTo(3.6, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    for (const x of [11, 15, 24, 28]) {
      for (const y of [11.5, 17.5]) {
        if (Math.hypot(x - 19.5, y - 14) < 4 || (x > 23 && y < 12)) continue;
        d.floor([x - 0.2, y - 0.2, x + 0.2, y + 0.2], (ctx) => {
          disc(ctx, x, y, 0.13, shade(th[0], 0.75), 0);
          disc(ctx, x, y, 0.07, shade(th[0], 1.15), 0);
        });
      }
    }
    d.pool(12.5, 12.5, 3.2, 0.1);
    d.pool(26.5, 12.5, 3.2, 0.1);
    // Hazard band along the base of the north wall, between the portholes.
    d.floor([x0, top - 0.25, x1, top], (ctx) => hazard(ctx, x0, top - 0.22, x1 - x0, 0.22, 0.36));
    for (const x of [11.5, 15.5, 19.5, 23.5, 27.5]) d.wall(top, x, 0.42, foldSeat);
    d.wall(top, 31.6, 0.24, extinguisher);
    // The exit hatch in the east hull, with stripes on the floor in front of it.
    d.floor([x1 - 0.8, 11.3, x1 + 1, 16.7], (ctx) => {
      hazard(ctx, x1 - 0.6, 11.6, 0.5, 4.8, 0.5);
      rr(ctx, x1 + 0.1, 11.6, 0.8, 4.8, 0.12, '#59636f', 0.07);
      rr(ctx, x1 + 0.22, 11.85, 0.56, 4.3, 0.08, '#6f7b88', 0.04);
      line(ctx, [x1 + 0.5, 11.9, x1 + 0.5, 16.1], INK, 0.04);
      for (const y of [12.6, 15.4]) rr(ctx, x1 + 0.3, y - 0.15, 0.4, 0.3, 0.04, YELLOW, 0.03);
    });
    d.floor([x1 - 3.2, 13, x1 - 0.6, 15], (ctx) => floorSign(ctx, x1 - 1.9, 14, 'EXIT', 'r'));
    d.live([x1, 10.9, x1 + 1, 11.6], (ctx, t) => {
      const on = t % 1.6 < 0.9;
      if (on) glow(ctx, x1 + 0.5, 11.25, 0.5, '94,227,106', 0.5);
      disc(ctx, x1 + 0.5, 11.25, 0.12, on ? '#5ee36a' : '#1f4a28', 0.04);
    });
    // Cargo straps over the crates (they are props, so straps go on top, live).
    for (const p of map.props) {
      if (p.kind !== 'crate') continue;
      const [cx0, cy0, cx1, cy1] = p.rect;
      d.live([cx0, cy0, cx1, cy1], (ctx) => {
        for (const f of [0.3, 0.7]) {
          const x = cx0 + (cx1 - cx0) * f;
          rr(ctx, x - 0.08, cy0 + 0.02, 0.16, cy1 - cy0 - 0.04, 0.02, '#e8892f', 0.035);
        }
        rr(ctx, cx0 + (cx1 - cx0) * 0.3 - 0.12, (cy0 + cy1) / 2 - 0.08, 0.24, 0.16, 0.03, '#c9ced4', 0.03);
      });
    }
  },
};

function engineRoom(d, [, top], th, o) {
  const [ex0, ey0, ex1, ey1] = o.engine;
  d.floor([ex0 - 1, ey0 - 1, ex1 + 1, ey1 + 1], (ctx) => hazardFrame(ctx, o.engine, 0.32, 0.28, 'tbr'));
  for (const [x, y, r] of o.stains) d.floor([x - r * 1.5, y - r, x + r * 1.5, y + r], (ctx) => stain(ctx, x, y, r, (x * 7) | 0));
  d.floor(bounds(o.cable, 0.2), (ctx) => cable(ctx, o.cable, '#c9a64a'));
  const [gx, gy] = o.grate;
  d.floor([gx - 1.3, gy - 0.9, gx + 1.3, gy + 0.9], (ctx) => grate(ctx, gx, gy, 2.4, 1.6, th[0]));
  d.pipes(top, o.pipes[0], o.pipes[1], th);
  o.gauges.forEach((x, i) => d.wall(top, x, 0.22, (ctx) => gauge(ctx, x, top, i + (top | 0))));
  d.wall(top, o.sign[0], 0.34, o.sign[1]);
  if (o.lamp) d.lamp(top, o.lamp);
  // Exhaust flicker at the engine's nozzle.
  const ex = ex0 - 0.1;
  const ey = (ey0 + ey1) / 2;
  const eh = (ey1 - ey0) * 0.32;
  d.live([ex - 2.2, ey - eh - 1, ex + 2.2, ey + eh + 1], (ctx, t) => {
    const f = 0.78 + 0.14 * Math.sin(t * 9 + ey) + 0.08 * Math.sin(t * 23.7);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ex - 0.9, ey - eh - 1, 3.2, eh * 2 + 2);
    ctx.clip();
    glow(ctx, ex, ey, 2.2, '255,154,60', 0.3 * f);
    oval(ctx, ex, ey, 0.2 * f, eh * 0.78 * f, `rgba(255,222,140,${0.8 * f})`);
    ctx.restore();
  });
}

/** Live drawer for a set of blinking LEDs: [x, y, seed, color]. */
function ledBlink(leds) {
  return (ctx, t) => {
    for (const [x, y, s, c] of leds) {
      const on = hash(s, Math.floor(t * (1.3 + (s % 3) * 0.6))) > 0.3;
      ctx.fillStyle = on ? c : 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 0.04, y - 0.04, 0.08, 0.08);
    }
  };
}

const cache = new Map();

function decorFor(map) {
  let dec = cache.get(map.id);
  if (!dec) cache.set(map.id, (dec = build(map)));
  return dec;
}

const hits = (b, x0, y0, x1, y1) => b[2] > x0 && b[0] < x1 && b[3] > y0 && b[1] < y1;

/** Soft shadow where floor meets a wall: strong under north walls, faint along the sides. */
function contactShadows(ctx, map, x0, y0, x1, y1) {
  const { W, H, floor } = map;
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor[y * W + x];
  const xa = Math.max(0, x0);
  const xb = Math.min(W, x1);
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    let g = null;
    for (let x = xa; x < xb; x++) {
      if (!isFloor(x, y) || isFloor(x, y - 1)) continue;
      let e = x;
      while (e < xb && isFloor(e, y) && !isFloor(e, y - 1)) e++;
      if (!g) {
        g = ctx.createLinearGradient(0, y, 0, y + 0.9);
        g.addColorStop(0, 'rgba(0,0,0,0.26)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, e - x, 0.9);
      x = e - 1;
    }
  }
  for (let x = xa; x < xb; x++) {
    for (const side of [-1, 1]) {
      let g = null;
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        if (!isFloor(x, y) || isFloor(x + side, y)) continue;
        let e = y;
        while (e < Math.min(H, y1) && isFloor(x, e) && !isFloor(x + side, e)) e++;
        if (!g) {
          const ex = side < 0 ? x : x + 1;
          g = ctx.createLinearGradient(ex, 0, ex - side * 0.4, 0);
          g.addColorStop(0, 'rgba(0,0,0,0.15)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
        }
        ctx.fillStyle = g;
        ctx.fillRect(side < 0 ? x : x + 0.6, y, 0.4, e - y);
        y = e - 1;
      }
    }
  }
}

/** Door thresholds: a darker plate with hazard edging across every door strip. */
function thresholds(ctx, map, x0, y0, x1, y1) {
  for (const dr of map.doors) {
    const [a, b, c, e] = dr.rect;
    if (!hits(dr.rect, x0 - 1, y0 - 1, x1 + 1, y1 + 1)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(a, b, c - a, e - b);
    ctx.save();
    ctx.globalAlpha = 0.75;
    if (dr.vertical) {
      hazard(ctx, a, b, 0.16, e - b, 0.3);
      hazard(ctx, c - 0.16, b, 0.16, e - b, 0.3);
    } else {
      hazard(ctx, a, b, c - a, 0.16, 0.3);
      hazard(ctx, a, e - 0.16, c - a, 0.16, 0.3);
    }
    ctx.restore();
  }
}

/** Static decor for the part of the map inside [x0, x1) x [y0, y1) (cell units). */
export function drawDecor(ctx, map, x0, y0, x1, y1) {
  const dec = decorFor(map);
  ctx.save();
  contactShadows(ctx, map, x0, y0, x1, y1);
  thresholds(ctx, map, x0, y0, x1, y1);
  for (const it of dec.items) {
    if (!hits(it.b, x0 - 0.1, y0 - 0.1, x1 + 0.1, y1 + 0.1)) continue;
    ctx.save();
    it.d(ctx);
    ctx.restore();
  }
  ctx.restore();
}

/** Animated decor (blinking lights, glows) for the visible area, drawn every frame. */
export function drawDecorLive(ctx, map, t, x0, y0, x1, y1) {
  const dec = decorFor(map);
  for (const it of dec.live) {
    if (!hits(it.b, x0 - 1, y0 - 1, x1 + 1, y1 + 2)) continue;
    ctx.save();
    it.d(ctx, t);
    ctx.restore();
  }
}
