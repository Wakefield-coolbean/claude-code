// Procedural particle sprites (original pixel art in the style of Minecraft Java particles).
// White / light-grey sprites are meant to be tinted by the engine (smoke, dust, drips, notes...).
// Pure JS, deterministic, no DOM.
import { PixelCanvas, toRGBA } from './pixel.js';
import { Noise } from '../util/noise.js';

const C = (hex, a = 255) => { const c = toRGBA(hex); c[3] = a; return c; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const step = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];

/** Draw a char-map; palette entries are colours (or functions (x, y) -> colour). */
function sprite(w, h, rows, palette, ox = 0, oy = 0) {
  const c = new PixelCanvas(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let col = palette[row[x]];
      if (typeof col === 'function') col = col(x, y);
      if (col != null) c.set(ox + x, oy + y, col);
    }
  });
  return c;
}

// ---- generic puff: 0 = big soft puff .. 7 = single dot --------------------------------------
function generic(f) {
  const c = new PixelCanvas(8, 8);
  const G = [C('#B9B9B9'), C('#D2D2D2'), C('#E6E6E6'), C('#F6F6F6'), C('#FFFFFF')];
  if (f === 7) { c.set(3, 3, G[4]); return c; }
  const R = [3.95, 3.5, 3.05, 2.6, 2.15, 1.62, 1.05][f];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const dx = x + 0.5 - 4, dy = y + 0.5 - 4;
    const ang = Math.atan2(dy, dx);
    const lump = R > 2.5 ? 1 : 0; // only the bigger puffs get a lumpy outline
    const rr = R * (1 + lump * (0.07 * Math.sin(ang * 3 + f * 1.7) + 0.04 * Math.sin(ang * 5 + f)));
    const d = Math.hypot(dx, dy);
    if (d > rr) continue;
    const light = -(dx + dy) / (2 * R); // +: toward the upper-left
    const v = 0.72 + 0.3 * light - 0.35 * (d / rr) ** 2;
    c.set(x, y, step(G, clamp01(v)));
  }
  return c;
}

// ---- explosion: billowing puff that swells then breaks apart -------------------------------
// Rendered as a union of shaded spheres ("cauliflower" billows) lit from the upper left.
function explosion(f) {
  const c = new PixelCanvas(16, 16);
  const t = f / 15;
  const rand = mulberry(0xE5A1);
  const nz = new Noise(4242);
  const balls = [{ x: 8, y: 8.4, r: 4.3, z: 1.6 }];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39996 + rand() * 0.5, dist = 2.7 + rand() * 2.3;
    balls.push({ x: 8 + Math.cos(a) * dist, y: 8.4 + Math.sin(a) * dist * 0.9, r: 1.9 + rand() * 1.6, z: rand() * 1.4 });
  }
  const grow = 0.5 + 0.62 * Math.sqrt(t), spread = 0.78 + 0.4 * t;
  const Lx = -0.52, Ly = -0.62, Lz = 0.59;
  const GR = [C('#6A6A6A'), C('#838383'), C('#9C9C9C'), C('#B5B5B5'), C('#CDCDCD'), C('#E3E3E3'), C('#F4F4F4'), C('#FFFFFF')];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = x + 0.5, py = y + 0.5;
    let best = -Infinity, n = null;
    for (const b of balls) {
      const bx = 8 + (b.x - 8) * spread, by = 8.4 + (b.y - 8.4) * spread, r = b.r * grow;
      const dx = px - bx, dy = py - by, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const h = Math.sqrt(r * r - d2) + b.z;
      if (h > best) { best = h; n = [dx / r, dy / r, Math.sqrt(1 - d2 / (r * r))]; }
    }
    if (!n) continue;
    // dissolve: thin rims go first, then noise holes spread through the puff
    const nv = (nz.noise2(px * 0.5, py * 0.5) + 1) / 2;
    if (nv * 0.75 + n[2] * 0.45 < (t - 0.28) * 1.35) continue;
    const lam = Math.max(0, n[0] * Lx + n[1] * Ly + n[2] * Lz);
    const v = (0.28 + 0.72 * lam) * (1 - t * 0.42) + 0.08;
    const col = step(GR, clamp01(v)).slice();
    col[3] = t < 0.62 ? 255 : Math.round(255 * (1 - (t - 0.62) * 1.3));
    c.set(x, y, col);
  }
  return c;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let q = Math.imul(a ^ (a >>> 15), 1 | a);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- small hand-drawn sprites ---------------------------------------------------------------
const W = C('#FFFFFF'), L = C('#E0E0E0'), M = C('#BEBEBE'), S = C('#9C9C9C');

const crit = () => sprite(8, 8, [
  '...W....',
  '.L.W.L..',
  '..LWL...',
  'WWWWWWW.',
  '..LWL...',
  '.L.W.L..',
  '...W....',
  '........',
], { W, L });

const enchantedHit = () => sprite(8, 8, [
  '...s....',
  '...W....',
  '..LWL...',
  'sWWWWWs.',
  '..LWL...',
  '...W....',
  '...s....',
  '........',
], { W, L, s: C('#FFFFFF', 130) });

function heartSprite(pal) {
  return sprite(8, 8, [
    '........',
    '.OO.OO..',
    'OhMORRO.',
    'ORRRRRO.',
    '.ORRDO..',
    '..ODO...',
    '...O....',
    '........',
  ], pal);
}

const heart = () => heartSprite({ O: C('#7A0B0B'), R: C('#E0231D'), h: C('#FFA29A'), M: C('#FF5A50'), D: C('#AE1510') });
const damage = () => heartSprite({ O: C('#1C0404'), R: C('#4E1010'), h: C('#8E3A3A'), M: C('#6A1C1C'), D: C('#340A0A') });

const angry = () => sprite(8, 8, [
  '........',
  '...hhh..',
  '.hhMMMh.',
  'hMMMMMMh',
  'MMMMMMMM',
  'dMMMMMMd',
  '.dddddd.',
  '........',
], { h: C('#6E6E6E'), M: C('#424242'), d: C('#262626') });

const flame = () => sprite(8, 8, [
  '...r....',
  '...rr...',
  '..rOr...',
  '..rOOr..',
  '.rOYOr..',
  '.rOYWOr.',
  '.rOWWOr.',
  '..rOOr..',
], { r: C('#D43A0C'), O: C('#F57A17'), Y: C('#FFC23A'), W: C('#FFF3B5') });

const lava = () => sprite(8, 8, [
  '........',
  '........',
  '..oOo...',
  '.oOYOo..',
  '.OYWYO..',
  '.oOYOo..',
  '..ooo...',
  '........',
], { o: C('#B8350A'), O: C('#EE6A10'), Y: C('#FFAE2A'), W: C('#FFEA96') });

const bubble = () => sprite(8, 8, [
  '..BBBB..',
  '.Bh..sB.',
  'Bh....sB',
  'B.....sB',
  'B.....sB',
  'Bs...ssB',
  '.BssssB.',
  '..BBBB..',
], { B: C('#D8ECFF', 235), h: C('#FFFFFF'), s: C('#FFFFFF', 45) });

const SPLASH = [
  ['........', '........', '........', '...WL...', '...LM...', '........', '........', '........'],
  ['........', '........', '...W....', '..WLL...', '..LLM...', '...M....', '........', '........'],
  ['........', '.W......', '.LM..W..', '.....LM.', '..W.....', '..M.....', '........', '........'],
  ['........', '....W...', '.W..M...', '.M....W.', '......M.', '...W....', '...M....', '........'],
];
const splash = (k) => sprite(8, 8, SPLASH[k], { W, L, M });

const dripHang = () => sprite(8, 8, [
  '...LL...',
  '...WL...',
  '..WWLM..',
  '..LLMM..',
  '...MM...',
  '........',
  '........',
  '........',
], { W, L, M });
const dripFall = () => sprite(8, 8, [
  '........',
  '........',
  '...W....',
  '...WL...',
  '..WLLM..',
  '..LLMM..',
  '...MM...',
  '........',
], { W, L, M });
const dripLand = () => sprite(8, 8, [
  '........',
  '........',
  '........',
  '........',
  '........',
  '.W....W.',
  '..WLLM..',
  'WLLLLMMM',
], { W, L, M });

const note = () => sprite(8, 8, [
  '....WW..',
  '....WLW.',
  '....W.LM',
  '....W..M',
  '....W...',
  '..WWW...',
  '.WLLM...',
  '..MM....',
], { W, L, M });

// ---- sweep attack crescent ------------------------------------------------------------------
function sweep(f) {
  const c = new PixelCanvas(32, 16);
  const head = Math.min(1.25, 0.28 + f * 0.2);
  const len = 0.95;
  const fade = f < 5 ? 1 : 1 - (f - 4) * 0.24;
  const thin = f < 4 ? 0 : (f - 3) * 0.05;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    const X = x + 0.5, Y = y + 0.5;
    const vo = ((X - 16) / 15.5) ** 2 + ((Y - 17) / 15.5) ** 2;
    const vi = ((X - 16) / (14.2 - thin * 10)) ** 2 + ((Y - 20.2 + thin * 20) / (13.2 - thin * 8)) ** 2;
    if (vo > 1 || vi < 1) continue;
    const ang = Math.atan2(17 - Y, X - 16); // 0 right .. PI left
    const u = 1 - ang / Math.PI; // 0 left .. 1 right (sweep runs left -> right)
    if (u > head || u < head - len) continue;
    const along = 1 - (head - u) / len; // 1 at the leading edge
    const band = Math.min(1 - vo, vi - 1) * 6; // 0 at band edge
    const bright = clamp01(band) * 0.6 + along * 0.4;
    const col = bright > 0.72 ? C('#FFFFFF') : bright > 0.45 ? C('#EDEDED') : bright > 0.25 ? C('#D2D2D2') : C('#B4B4B4');
    col[3] = Math.round(255 * fade * clamp01(0.25 + along * 0.85));
    if (col[3] > 8) c.set(x, y, col);
  }
  return c;
}

// ---- experience orbs --------------------------------------------------------------------------
function xpOrb(k) {
  const c = new PixelCanvas(16, 16);
  const R = 1.25 + k * 0.58;
  const OUT = C('#2F6508'), PAL = [C('#4E9A0E'), C('#7CC91C'), C('#A9E632'), C('#D6F85A'), C('#F7FFA8'), C('#FFFFFF')];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
    const d = Math.hypot(dx, dy);
    if (d <= R) {
      if (k >= 2 && d > R - 1) { c.set(x, y, OUT); continue; }
      const hl = -(dx + dy * 1.2) / (2.2 * R);
      const v = 0.3 + (1 - d / R) * 0.55 + hl * 0.45;
      c.set(x, y, step(PAL, clamp01(v)));
    } else if (k >= 4 && d <= R + 1.2) {
      c.set(x, y, C('#B6F23C', Math.round(70 - (d - R) * 35)));
    }
  }
  return c;
}

/** @returns {Map<string, {w:number, h:number, data:Uint8ClampedArray}>} */
export function generateParticleTextures() {
  const out = new Map();
  const put = (name, c) => out.set(name, { w: c.w, h: c.h, data: c.data });
  for (let i = 0; i < 8; i++) put(`generic_${i}`, generic(i));
  for (let i = 0; i < 16; i++) put(`explosion_${i}`, explosion(i));
  put('crit', crit());
  put('enchanted_hit', enchantedHit());
  put('heart', heart());
  put('angry', angry());
  put('damage', damage());
  put('flame', flame());
  put('lava', lava());
  put('bubble', bubble());
  for (let i = 0; i < 4; i++) put(`splash_${i}`, splash(i));
  put('drip_hang', dripHang());
  put('drip_fall', dripFall());
  put('drip_land', dripLand());
  put('note', note());
  for (let i = 0; i < 8; i++) put(`sweep_${i}`, sweep(i));
  for (let i = 0; i <= 10; i++) put(`xp_orb_${i}`, xpOrb(i));
  return out;
}

