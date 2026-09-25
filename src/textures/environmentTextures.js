// Procedural sky / weather textures: sun, moon phases, cloud coverage map, rain and snow.
// Sun and moon are drawn additively by the engine, so black rgb means "nothing".
// Pure JS, deterministic, no DOM.
import { PixelCanvas, mix, toRGBA } from './pixel.js';
import { hashFloat } from '../util/rng.js';
import { Noise } from '../util/noise.js';

const C = (hex, a = 255) => { const c = toRGBA(hex); c[3] = a; return c; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a, n) => ((a % n) + n) % n;

// ---- sun (32x32): square white-yellow core with a yellow-orange rim and glow ----------------
function sun() {
  const c = new PixelCanvas(32, 32).fill([0, 0, 0, 255]);
  const RIM = [C('#FFC93C'), C('#FFE27A'), C('#FFF2B4'), C('#FFFBE2')];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const ox = Math.max(8 - x, x - 23, 0), oy = Math.max(8 - y, y - 23, 0);
    const out = Math.max(ox, oy);
    if (out === 0) {
      const e = Math.min(x - 8, 23 - x, y - 8, 23 - y); // 0 on the core's edge
      let col = e < RIM.length ? RIM[e] : C('#FFFFF6');
      if (e >= 5 && hashFloat(x, y, 11) > 0.8) col = C('#FFFFFF');
      c.set(x, y, col);
    } else if (out <= 5) {
      const g = (1 - out / 6) ** 2 * (ox && oy ? 0.7 : 1); // squarish glow, dimmer at the corners
      c.set(x, y, [255 * g * 0.95, 150 * g * 0.95, 30 * g, 255]);
    }
  }
  return c;
}

// ---- moon phases (128x64): 4x2 cells of 32x32 ------------------------------------------------
function moonSurface() {
  const nz = new Noise(7777);
  const S = 16;
  const base = [];
  const craters = [[4.5, 4, 2.2], [11, 5.5, 1.6], [7, 11, 2.6], [12.5, 12, 1.4], [2.5, 10.5, 1.2], [9, 2, 1], [14, 8.5, 1]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const mare = nz.noise2(x * 0.18, y * 0.18) + nz.noise2(x * 0.5 + 20, y * 0.5) * 0.3;
    let v = 0.62 + (mare > 0.15 ? -0.14 : 0) + (hashFloat(x, y, 5) - 0.5) * 0.08;
    for (const [cx, cy, r] of craters) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d < r) v -= 0.18 - ((dx + dy) / (2 * r)) * 0.14; // bowl: shadowed upper-left wall, lit lower-right
      else if (d < r + 0.8) v += 0.07; // rim
    }
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) v -= 0.06;
    base.push(clamp01(v));
  }
  return base;
}

function moonPhases() {
  const c = new PixelCanvas(128, 64).fill([0, 0, 0, 255]);
  const surf = moonSurface();
  const DARK = toRGBA('#8C95A6'), LIGHT = toRGBA('#E6ECF5');
  for (let k = 0; k < 8; k++) {
    const cx = (k % 4) * 32 + 8, cy = (k >> 2) * 32 + 8;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const nx = (x + 0.5 - 8) / 8, ny = (y + 0.5 - 8) / 8;
      const w = Math.sqrt(Math.max(0, 1 - 0.55 * ny * ny));
      let lit; // signed distance to the terminator, > 0 = lit
      if (k === 0) lit = 1;
      else if (k === 4) lit = -1;
      else if (k < 4) lit = Math.cos(k * Math.PI / 4) * w - nx; // waning: lit side on the left
      else lit = nx + Math.cos((8 - k) * Math.PI / 4) * w; // waxing: lit side on the right
      const col = mix(DARK, LIGHT, surf[y * 16 + x]);
      const f = lit > 0.1 ? 1 : lit > -0.1 ? 0.45 : 0.06; // dark side keeps a faint earthshine
      c.set(cx + x, cy + y, [col[0] * f, col[1] * f, col[2] * f, 255]);
    }
  }
  return c;
}

// ---- clouds (256x256): tileable blocky coverage map ------------------------------------------
function clouds() {
  const N = 256;
  const lattice = (period, seed) => (x, y) => {
    const cell = N / period;
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (i, j) => hashFloat(mod(i, period), mod(j, period), seed, 91);
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  // nearest-neighbour octaves give the stair-stepped, rectangular edges of a blocky cloud map
  const blocky = (period, seed) => (x, y) => {
    const cell = N / period;
    return hashFloat(mod(Math.floor(x / cell), period), mod(Math.floor(y / cell), period), seed, 92);
  };
  const octs = [[lattice(16, 1), 0.52], [lattice(32, 2), 0.24], [blocky(32, 3), 0.1], [blocky(64, 4), 0.14]];
  const val = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [f, a] of octs) v += f(x, y) * a;
    val[y * N + x] = v;
  }
  const sorted = Float32Array.from(val).sort();
  const thresh = sorted[Math.floor(N * N * 0.6)];
  let m = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) m[i] = val[i] > thresh ? 1 : 0;
  // cleanup (wrapping): drop lone specks / fill pinholes, keep the blocky stair-step edges
  for (let pass = 0; pass < 2; pass++) {
    const n2 = new Uint8Array(m);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s4 = 0, s8 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const v = m[mod(y + dy, N) * N + mod(x + dx, N)];
        s8 += v; if (!dx || !dy) s4 += v;
      }
      const i = y * N + x;
      if (m[i] && (s4 <= 1 || s8 <= 2)) n2[i] = 0;
      else if (!m[i] && (s4 >= 3 || s8 >= 6)) n2[i] = 1;
    }
    m = n2;
  }
  const c = new PixelCanvas(N, N);
  for (let i = 0; i < N * N; i++) if (m[i]) c.data.set([255, 255, 255, 255], i * 4);
  return c;
}

// ---- rain (64x256) & snow (64x256): vertically tileable ---------------------------------------
function rain() {
  const c = new PixelCanvas(64, 256);
  const put = (x, y, a) => {
    y = mod(y, 256);
    const i = (y * 64 + x) * 4;
    if (c.data[i + 3] >= a) return;
    c.data.set([236, 242, 255, a], i);
  };
  for (let k = 0; k < 150; k++) {
    const x = Math.floor(hashFloat(k, 1, 77) * 64);
    const y = Math.floor(hashFloat(k, 2, 77) * 256);
    const len = 7 + Math.floor(hashFloat(k, 3, 77) * 14);
    const head = 150 + Math.floor(hashFloat(k, 4, 77) * 90);
    for (let t = 0; t < len; t++) put(x, y - t, Math.round(head * (1 - t / len) ** 1.3 + 20));
  }
  return c;
}

function snow() {
  const c = new PixelCanvas(64, 256);
  const put = (x, y, a, v = 255) => {
    x = mod(x, 64); y = mod(y, 256);
    const i = (y * 64 + x) * 4;
    if (c.data[i + 3] >= a) return;
    c.data.set([v, v, v, a], i);
  };
  for (let k = 0; k < 190; k++) {
    const x = Math.floor(hashFloat(k, 1, 88) * 64);
    const y = Math.floor(hashFloat(k, 2, 88) * 256);
    const kind = hashFloat(k, 3, 88);
    const a = 190 + Math.floor(hashFloat(k, 4, 88) * 65);
    if (kind < 0.45) put(x, y, a);
    else if (kind < 0.85) { put(x, y, a); put(x + 1, y, a - 40, 238); put(x, y + 1, a - 40, 238); put(x + 1, y + 1, a - 90, 222); }
    else { put(x, y, 255); put(x - 1, y, a - 60, 235); put(x + 1, y, a - 60, 235); put(x, y - 1, a - 60, 235); put(x, y + 1, a - 60, 235); }
  }
  return c;
}

/** @returns {Map<string, {w:number, h:number, data:Uint8ClampedArray}>} */
export function generateEnvironmentTextures() {
  const out = new Map();
  const put = (name, c) => out.set(name, { w: c.w, h: c.h, data: c.data });
  put('sun', sun());
  put('moon_phases', moonPhases());
  put('clouds', clouds());
  put('rain', rain());
  put('snow', snow());
  return out;
}
