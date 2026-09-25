// Procedural 16x16 block textures in the style of Minecraft Java Edition 1.14+.
//
// Every texture is drawn from code (tileable value noise, voronoi cells, periodic waves and
// hand-authored pixel patterns) and seeded per texture name, so the output is fully
// deterministic. Pure JS: works in browsers, workers and Node.
//
//   generateBlockTextures() -> Map<name, Uint8ClampedArray[]>
//     each frame is a 16x16 RGBA array (row-major, top row first).
//     Static textures have 1 frame; animated ones (water, lava, fire) have several.
//
// Biome-tinted textures (grass, leaves, water, sugar cane, lily pad ...) are grayscale; the
// renderer multiplies them by the biome colour.
import { PixelCanvas, mix, seeded, toRGBA } from './pixel.js';
import { collectBlockTextureNames } from '../registry/blocks.js';

const N = 16;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const canvas = () => new PixelCanvas(N, N);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (v) => ((v % N) + N) % N;
const gray = (v, a = 255) => [v, v, v, a];
const ri = (rand, n) => Math.floor(rand() * n);
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const tdx = (a, b) => { let d = a - b; d -= N * Math.round(d / N); return d; };
const rgb = (c) => toRGBA(c);
function shade(c, f) { const a = toRGBA(c); return [a[0] * f, a[1] * f, a[2] * f, a[3]]; }
function lighten(c, t) { const a = toRGBA(c); return [a[0] + (255 - a[0]) * t, a[1] + (255 - a[1]) * t, a[2] + (255 - a[2]) * t, a[3]]; }
function setW(c, x, y, col) { c.set(wrap(x), wrap(y), col); }
function alphaAt(c, x, y) { return c.inside(x, y) ? c.data[c.idx(x, y) + 3] : 0; }

// Tileable value noise: lattice of cx * cy random values, smooth interpolation, period 16px.
function vnoise(rand, cx, cy = cx) {
  const g = new Float32Array(cx * cy);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const fx = (x / N) * cx, fy = (y / N) * cy;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % cx) + cx) % cx, x1 = (x0 + 1) % cx;
    const y0 = ((iy % cy) + cy) % cy, y1 = (y0 + 1) % cy;
    const a = g[y0 * cx + x0], b = g[y0 * cx + x1], c = g[y1 * cx + x0], d = g[y1 * cx + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}
// Sum of value-noise octaves: spec = [[cellsX, cellsY, weight], ...]
function fbm(rand, spec) {
  const ns = spec.map(([cx, cy, w]) => [vnoise(rand, cx, cy), w]);
  return (x, y) => { let s = 0; for (const [n, w] of ns) s += n(x, y) * w; return s; };
}
function field(fn) {
  const f = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[y * N + x] = fn(x, y);
  return f;
}
// Rank-normalise a field to a uniform [0,1) distribution so palette weights are exact.
function equalize(f) {
  const idx = Array.from({ length: f.length }, (_, i) => i).sort((a, b) => f[a] - f[b]);
  const out = new Float32Array(f.length);
  idx.forEach((i, r) => { out[i] = (r + 0.5) / f.length; });
  return out;
}
// Weighted discrete palette: t in [0,1) -> colour
function palette(colors, weights) {
  const cols = colors.map(rgb);
  const w = weights ?? cols.map(() => 1);
  const tot = w.reduce((a, b) => a + b, 0);
  const cum = []; let acc = 0;
  for (const v of w) { acc += v / tot; cum.push(acc); }
  return (t) => { for (let i = 0; i < cum.length; i++) if (t < cum[i]) return cols[i]; return cols[cols.length - 1]; };
}
function paint(c, f, pal) {
  for (let i = 0; i < N * N; i++) c.set(i & 15, i >> 4, pal(f[i]));
  return c;
}
function noiseTex(rand, spec, colors, weights) {
  return paint(canvas(), equalize(field(fbm(rand, spec))), palette(colors, weights));
}
const FINE = [[4, 4, 0.25], [8, 8, 0.3], [16, 16, 0.45]];
const GRAINY = [[4, 4, 0.15], [8, 8, 0.2], [16, 16, 0.65]];

// Blob points on a torus with a minimum spacing
function scatter(rand, n, minD, tries = 800) {
  const pts = [];
  for (let t = 0; t < tries && pts.length < n; t++) {
    const x = rand() * N, y = rand() * N;
    let ok = true;
    for (const p of pts) { const dx = tdx(p.x, x), dy = tdx(p.y, y); if (dx * dx + dy * dy < minD * minD) { ok = false; break; } }
    if (ok) pts.push({ x, y, w: 1 });
  }
  return pts;
}
// Tileable voronoi: per pixel nearest id, distance to nearest/second, offset from cell centroid.
function voronoi(pts, sx = 1, sy = 1) {
  const id = new Int16Array(256), d1 = new Float32Array(256), d2 = new Float32Array(256);
  const ox = new Float32Array(256), oy = new Float32Array(256);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let b1 = 1e9, b2 = 1e9, bi = 0, bx = 0, by = 0;
    for (let i = 0; i < pts.length; i++) {
      const dx = tdx(x + 0.5, pts[i].x), dy = tdx(y + 0.5, pts[i].y);
      const d = Math.sqrt(dx * dx * sx + dy * dy * sy) / pts[i].w;
      if (d < b1) { b2 = b1; b1 = d; bi = i; bx = dx; by = dy; } else if (d < b2) b2 = d;
    }
    const k = y * N + x;
    id[k] = bi; d1[k] = b1; d2[k] = b2; ox[k] = bx; oy[k] = by;
  }
  const n = pts.length, mx = new Float32Array(n), my = new Float32Array(n), cnt = new Float32Array(n);
  for (let k = 0; k < 256; k++) { mx[id[k]] += ox[k]; my[id[k]] += oy[k]; cnt[id[k]]++; }
  for (let k = 0; k < 256; k++) { const i = id[k]; ox[k] -= mx[i] / cnt[i]; oy[k] -= my[i] / cnt[i]; }
  return { id, d1, d2, ox, oy, cnt };
}

// Periodic waves (integer frequencies keep them seamless in x, y and time)
function mkWaves(rand, n, { kx = [-3, 3], ky = [-3, 3], kt = [1, -1] } = {}) {
  const w = [];
  while (w.length < n) {
    const a = kx[0] + ri(rand, kx[1] - kx[0] + 1), b = ky[0] + ri(rand, ky[1] - ky[0] + 1);
    if (a === 0 && b === 0) continue;
    w.push({ kx: a, ky: b, kt: pick(rand, kt), ph: rand() * TAU, a: 1 / Math.hypot(a, b) });
  }
  return w;
}
function waves(ws, x, y, tt) {
  let s = 0, nrm = 0;
  for (const w of ws) { s += w.a * Math.sin(TAU * ((w.kx * x + w.ky * y) / N + w.kt * tt) + w.ph); nrm += w.a; }
  return s / nrm;
}

// Char-map drawing helper
function sprite(rows, pal, base = null) {
  const c = base ? base.clone() : canvas();
  c.pattern(0, 0, rows, pal);
  return c;
}

// ---------------------------------------------------------------------------
// registry of generators
// ---------------------------------------------------------------------------
const GEN = Object.create(null);
function def(name, fn) { GEN[name] = fn; }

// ===========================================================================
// STONES
// ===========================================================================
const STONE = [0x5f5f5f, 0x6c6c6c, 0x767676, 0x7f7f7f, 0x898989, 0x959595];
def('stone', ({ rand }) => {
  const c = canvas();
  const f = equalize(field(fbm(rand, [[2, 4, 0.3], [4, 8, 0.3], [8, 16, 0.15], [16, 16, 0.25]])));
  paint(c, f, palette(STONE.slice(1), [8, 22, 38, 23, 9]));
  // small dark crevices with a pale lip above them
  for (let k = 0; k < 7; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 2 + ri(rand, 3);
    for (let i = 0; i < len; i++) setW(c, x + i, y, i === 0 || i === len - 1 ? STONE[1] : STONE[0]);
    setW(c, x + 1, y - 1, STONE[5]);
    if (len > 3) setW(c, x + 2, y - 1, STONE[4]);
  }
  return c;
});

function polished(rand, cols) {
  // cols: [shadow, dark, mid, light, highlight]
  const c = noiseTex(rand, FINE, [cols[1], cols[2], cols[3]], [22, 56, 22]);
  for (let i = 0; i < N; i++) {
    c.set(i, 0, cols[4]); c.set(0, i, cols[4]);
    c.set(i, 15, cols[0]); c.set(15, i, cols[0]);
  }
  for (let i = 1; i < 15; i++) { c.set(i, 1, mix(cols[3], cols[2], 0.5)); c.set(14, i, mix(cols[1], cols[2], 0.5)); }
  c.set(0, 15, cols[2]); c.set(15, 0, cols[2]);
  return c;
}
const GRANITE = [0x7a5041, 0x8c5d4b, 0x9b6a57, 0xa97763, 0xbc8b77, 0xcfa28f];
def('granite', ({ rand }) => {
  const c = noiseTex(rand, GRAINY, GRANITE, [8, 18, 28, 22, 16, 8]);
  for (let k = 0; k < 10; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, 0xdcb3a0); if (rand() < 0.5) setW(c, x + 1, y, GRANITE[4]); }
  for (let k = 0; k < 8; k++) setW(c, ri(rand, N), ri(rand, N), 0x6a4235);
  return c;
});
def('polished_granite', ({ rand }) => polished(rand, [0x734b3c, 0x94634f, 0x9f6b57, 0xab7864, 0xc1917c]));
const DIORITE = [0x7c7c7e, 0x9c9c9e, 0xbababa, 0xcacaca, 0xd8d8d8, 0xe8e8e8];
def('diorite', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.3], [8, 8, 0.3], [16, 16, 0.4]], DIORITE, [6, 11, 20, 28, 24, 11]);
  return c;
});
def('polished_diorite', ({ rand }) => polished(rand, [0x9a9a9c, 0xbdbdbd, 0xc9c9c9, 0xd5d5d5, 0xeaeaea]));
const ANDESITE = [0x6a6a6b, 0x77777a, 0x828284, 0x8c8c8e, 0x98989a, 0xa9a9aa];
def('andesite', ({ rand }) => noiseTex(rand, GRAINY, ANDESITE, [8, 18, 28, 24, 15, 7]));
def('polished_andesite', ({ rand }) => polished(rand, [0x6c6c6e, 0x7f7f81, 0x88898b, 0x929394, 0xa4a5a6]));

def('smooth_stone', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x999999, 0x9e9e9e, 0xa4a4a4], [25, 50, 25]);
  for (let i = 0; i < N; i++) { c.set(i, 0, 0x8a8a8a); c.set(i, 15, 0x8a8a8a); c.set(0, i, 0x8a8a8a); c.set(15, i, 0x8a8a8a); }
  return c;
});
def('smooth_stone_slab_side', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x999999, 0x9e9e9e, 0xa4a4a4], [25, 50, 25]);
  for (let i = 0; i < N; i++) {
    for (const y of [0, 7, 8, 15]) c.set(i, y, 0x8a8a8a);
    c.set(0, i, 0x8a8a8a); c.set(15, i, 0x8a8a8a);
    if (i > 0 && i < 15) { c.set(i, 1, 0xababab); c.set(i, 9, 0xababab); c.set(i, 7, 0x7f7f7f); }
  }
  return c;
});

// ---- cobblestone style cells ----
function cobbleTex(rand, { n = 10, minD = 4, gap = 1.1, stones, mortar, bevel = 0.3, slope = 0.05, grain = 0.2, sizeVar = 0.45 }) {
  const pts = scatter(rand, n, minD);
  for (const p of pts) p.w = 0.8 + rand() * sizeVar;
  const v = voronoi(pts);
  const M = new Uint8Array(256);
  for (let k = 0; k < 256; k++) M[k] = v.d2[k] - v.d1[k] < gap ? 1 : 0;
  const isM = (x, y) => M[wrap(y) * N + wrap(x)];
  const tone = pts.map(() => (rand() - 0.5) * 0.32);
  const nz = vnoise(rand, 16);
  const pal = palette(stones);
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    if (M[k]) {
      const deep = isM(x - 1, y) + isM(x + 1, y) + isM(x, y - 1) + isM(x, y + 1);
      c.set(x, y, deep >= 3 ? mortar[0] : mortar[1]);
    } else {
      let t = 0.5 + tone[v.id[k]] - (v.ox[k] + v.oy[k]) * slope + (nz(x, y) - 0.5) * grain;
      if (isM(x, y - 1) || isM(x - 1, y)) t += bevel;
      if (isM(x, y + 1) || isM(x + 1, y)) t -= bevel;
      c.set(x, y, pal(clamp01(t)));
    }
  }
  return c;
}
const COBBLE = { stones: [0x5d5d5d, 0x6e6e6e, 0x7b7b7b, 0x888888, 0x979797, 0xababab], mortar: [0x3e3e3e, 0x4b4b4b] };
def('cobblestone', ({ rand }) => cobbleTex(rand, { ...COBBLE, n: 11, minD: 3.9 }));

function mossify(c, rand, amount, { mortarBias = true, cols = [0x3f5a23, 0x4e6b2a, 0x5f7f32, 0x6f9139] } = {}) {
  const f = equalize(field(fbm(rand, [[2, 2, 0.45], [4, 4, 0.4], [16, 16, 0.15]])));
  const g = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    const p = c.get(x, y);
    const lum = (p[0] + p[1] + p[2]) / 3;
    const t = f[k] + (mortarBias && lum < 80 ? 0.12 : 0);
    if (t > 1 - amount) {
      const edge = t < 1 - amount + 0.08;
      const s = clamp01((lum - 60) / 100) * 0.6 + g(x, y) * 0.4;
      let i = Math.min(cols.length - 1, Math.floor(s * cols.length));
      if (edge) i = Math.max(0, i - 1);
      c.set(x, y, cols[i]);
    }
  }
  return c;
}
def('mossy_cobblestone', ({ rand, get }) => mossify(get('cobblestone')[0].clone(), rand, 0.38));

// ---- bricks ----
function stoneBricksBase(rand, { face, hi, lo, mortar, n2 = 0x707070 }) {
  const c = canvas();
  const nz = equalize(field(fbm(rand, FINE)));
  const pal = palette(face, [25, 50, 25]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const course = y < 8 ? 0 : 1;
    const yy = y % 8;
    const jx = course === 0 ? 15 : 7; // vertical joint column
    if (yy === 7 || x === jx) { c.set(x, y, mortar); continue; }
    let col = pal(nz[y * N + x]);
    const left = wrap(x - 1) === jx, right = wrap(x + 1) === jx;
    if (yy === 0 || left) col = hi;
    if (yy === 6 || right) col = lo;
    if ((yy === 0 && right) || (yy === 6 && left)) col = face[1];
    c.set(x, y, col);
  }
  return c;
}
const SBRICK = { face: [0x747474, 0x7b7b7b, 0x828282], hi: 0x8f8f8f, lo: 0x656565, mortar: 0x4f4f4f };
def('stone_bricks', ({ rand }) => stoneBricksBase(rand, SBRICK));
def('mossy_stone_bricks', ({ rand, get }) => mossify(get('stone_bricks')[0].clone(), rand, 0.36));
def('cracked_stone_bricks', ({ rand, get }) => {
  const c = get('stone_bricks')[0].clone();
  const cracks = [
    [[2, 1], [3, 2], [3, 3], [4, 4], [5, 4], [6, 5]],
    [[10, 2], [10, 3], [11, 4], [12, 4], [12, 5], [13, 6]],
    [[4, 9], [5, 10], [5, 11], [6, 12], [6, 13], [7, 13]],
    [[11, 9], [12, 10], [12, 11], [11, 12], [11, 13], [12, 14]],
    [[1, 11], [2, 12], [2, 13]],
    [[8, 3], [8, 4], [9, 5]],
  ];
  for (const cr of cracks) {
    for (const [x, y] of cr) { c.set(x, y, 0x4a4a4a); if (rand() < 0.7) c.set(x + 1, y, 0x5b5b5b); }
  }
  return c;
});

def('bricks', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  const mortar = [0xa29d97, 0x8e8983];
  const brick = [0x7f3d2f, 0x8f4a3a, 0x9a5645, 0xa6604d, 0xb46e59];
  for (let course = 0; course < 4; course++) {
    const y0 = course * 4;
    const off = course % 2 ? 4 : 0;
    // tone per brick
    const tones = [ri(rand, 3) - 1, ri(rand, 3) - 1];
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < N; x++) {
      const bx = wrap(x - off);
      if (y === y0 + 3) { c.set(x, y, bx === 7 || bx === 15 ? mortar[1] : mortar[0]); continue; }
      if (bx === 7 || bx === 15) { c.set(x, y, mortar[0]); continue; }
      const which = bx < 7 ? 0 : 1;
      let i = 2 + tones[which] + Math.round((nz(x, y) - 0.5) * 1.8);
      if (y === y0) i += 1;
      if (y === y0 + 2) i -= 1;
      c.set(x, y, brick[Math.max(0, Math.min(4, i))]);
    }
  }
  return c;
});

// ===========================================================================
// DEEPSLATE family
// ===========================================================================
const DS = [0x2e2e33, 0x3b3b41, 0x45454b, 0x4f4f55, 0x5a5a61, 0x67676e];
def('deepslate', ({ rand }) => {
  const c = noiseTex(rand, [[2, 8, 0.35], [4, 16, 0.3], [16, 16, 0.35]], DS.slice(1), [10, 24, 34, 22, 10]);
  for (let k = 0; k < 9; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 3 + ri(rand, 5);
    for (let i = 0; i < len; i++) setW(c, x + i, y, DS[0]);
    for (let i = 1; i < len - 1; i++) if (rand() < 0.6) setW(c, x + i, y - 1, DS[5]);
  }
  return c;
});
// irregular concentric swirl (the cut face of layered rock), tileable via torus distance
function swirlTop(rand, P) {
  // P: 6 shades dark -> light
  const c = canvas();
  const warp = fbm(rand, [[2, 2, 0.6], [4, 4, 0.4]]);
  const fine = vnoise(rand, 16);
  const ringOf = (x, y) => {
    const d = Math.hypot(tdx(wrap(x) + 0.5, 8), tdx(wrap(y) + 0.5, 8)) + (warp(wrap(x), wrap(y)) - 0.5) * 5;
    return d / 2.7;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = ringOf(x, y), b = Math.floor(r), fr = r - b;
    let col = fr < 0.4 ? P[4] : fr < 0.75 ? P[3] : P[2];
    if (Math.floor(ringOf(x + 1, y)) > b || Math.floor(ringOf(x, y + 1)) > b) col = P[0];
    else if (Math.floor(ringOf(x - 1, y)) < b && Math.floor(ringOf(x, y - 1)) < b) col = P[5];
    if (fine(x, y) > 0.94) col = P[5]; else if (fine(x, y) < 0.05) col = P[1];
    c.set(x, y, col);
  }
  return c;
}
def('deepslate_top', ({ rand }) => swirlTop(rand, DS));
def('cobbled_deepslate', ({ rand }) => cobbleTex(rand, {
  n: 12, minD: 3.6, gap: 1.05, stones: [0x3a3a40, 0x46464c, 0x505057, 0x5a5a62, 0x66666e, 0x75757d],
  mortar: [0x1f1f23, 0x2a2a2f], bevel: 0.3,
}));
def('polished_deepslate', ({ rand }) => {
  const c = noiseTex(rand, GRAINY, [0x3f3f45, 0x46464c, 0x4c4c52, 0x535359, 0x5b5b62], [10, 25, 35, 20, 10]);
  for (let i = 0; i < N; i++) {
    c.set(i, 0, 0x66666d); c.set(0, i, 0x66666d);
    c.set(i, 15, 0x2a2a2f); c.set(15, i, 0x2a2a2f);
  }
  for (let i = 1; i < 15; i++) { c.set(i, 1, 0x5a5a61); c.set(1, i, 0x5a5a61); c.set(i, 14, 0x38383d); c.set(14, i, 0x38383d); }
  return c;
});
def('deepslate_bricks', ({ rand }) => {
  const c = canvas();
  const nz = equalize(field(fbm(rand, FINE)));
  const pal = palette([0x45454b, 0x4d4d53, 0x55555b], [30, 45, 25]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const course = y >> 2, yy = y & 3;
    const off = course % 2 ? 4 : 0;
    const bx = wrap(x - off);
    if (yy === 3 || bx === 7 || bx === 15) { c.set(x, y, 0x26262a); continue; }
    let col = pal(nz[y * N + x]);
    if (yy === 0) col = 0x64646b;
    if (bx === 0 || bx === 8) col = yy === 0 ? 0x6c6c73 : 0x5a5a61;
    if (yy === 2 && rand() < 0.5) col = 0x3c3c42;
    c.set(x, y, col);
  }
  return c;
});
def('deepslate_tiles', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    const tone = rand();
    const base = tone < 0.3 ? [0x3a3a40, 0x42424a, 0x4a4a52] : tone < 0.75 ? [0x42424a, 0x4a4a51, 0x535359] : [0x4a4a51, 0x535359, 0x5d5d64];
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const x = tx * 4 + xx, y = ty * 4 + yy;
      if (xx === 3 || yy === 3) { c.set(x, y, 0x222226); continue; }
      let col = base[1];
      if (yy === 0 || xx === 0) col = base[2];
      if (yy === 2 || xx === 2) col = base[0];
      if (yy === 0 && xx === 0) col = lighten(base[2], 0.08);
      if (nz(x, y) < 0.12) col = base[0];
      c.set(x, y, col);
    }
  }
  return c;
});

const TUFF = [0x55564f, 0x61625a, 0x6c6d65, 0x77786f, 0x84867b, 0x92948a];
def('tuff', ({ rand }) => {
  const c = noiseTex(rand, GRAINY, TUFF.slice(0, 5), [10, 22, 34, 22, 12]);
  for (let k = 0; k < 9; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    setW(c, x, y, TUFF[5]); setW(c, x + 1, y, TUFF[4]); setW(c, x, y + 1, TUFF[3]); setW(c, x + 1, y + 1, TUFF[1]);
  }
  return c;
});
def('calcite', ({ rand }) => {
  const c = noiseTex(rand, [[2, 2, 0.3], [4, 4, 0.3], [16, 16, 0.4]], [0xc5c7c1, 0xd3d5cf, 0xdedfda, 0xe8e9e5, 0xf2f3f0], [6, 18, 40, 28, 8]);
  for (let k = 0; k < 4; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 2 + ri(rand, 3);
    for (let i = 0; i < len; i++) setW(c, x + i, y + (i >> 1), 0xbcbeb7);
  }
  return c;
});
def('dripstone_block', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16), wob = vnoise(rand, 4, 2);
  const pal = palette([0x5f4a3f, 0x6d574b, 0x7c6456, 0x8b7163, 0x9b8172, 0xab9283], [8, 18, 26, 26, 15, 7]);
  const f = equalize(field((x, y) => Math.sin(TAU * (y + wob(x, y) * 4) * 3 / N) * 0.6 + nz(x, y) * 0.6));
  paint(c, f, pal);
  return c;
});

// ===========================================================================
// DIRT, GRASS, SAND ...
// ===========================================================================
const DIRT = [0x5a3e2b, 0x6b4a33, 0x79553a, 0x866043, 0x946e4e, 0xa57d59];
def('dirt', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.25], [8, 8, 0.25], [16, 16, 0.5]], DIRT, [8, 18, 26, 27, 14, 7]);
  // a few pale pebbles and dark clods
  for (let k = 0; k < 5; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, 0xb08a67); setW(c, x + 1, y + 1, DIRT[1]); }
  for (let k = 0; k < 6; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, DIRT[0]); if (rand() < 0.5) setW(c, x + 1, y, DIRT[1]); }
  return c;
});
def('coarse_dirt', ({ rand, get }) => {
  const c = noiseTex(rand, [[4, 4, 0.3], [8, 8, 0.25], [16, 16, 0.45]], [0x4c3524, 0x5d412d, 0x6e4e36, 0x7d5a3f, 0x8b6749, 0x9a7555], [10, 18, 24, 24, 16, 8]);
  // grey-brown gravelly stones
  for (let k = 0; k < 9; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    const s = pick(rand, [[0x77695e, 0x5e5249, 0x8f8175], [0x6b5a4c, 0x51443a, 0x857364]]);
    setW(c, x, y, s[2]); setW(c, x + 1, y, s[0]); setW(c, x, y + 1, s[0]); setW(c, x + 1, y + 1, s[1]);
    if (rand() < 0.5) setW(c, x + 2, y + 1, s[1]);
  }
  return c;
});

const GRASS_TOP = [gray(108), gray(124), gray(140), gray(156), gray(174), gray(196)];
def('grass_block_top', ({ rand }) => noiseTex(rand, [[4, 4, 0.18], [8, 8, 0.3], [16, 16, 0.52]], GRASS_TOP, [7, 16, 26, 26, 17, 8]));

function fringeDepths(rand, base, extra) {
  const d = [];
  for (let x = 0; x < N; x++) {
    let v = base;
    const r = rand();
    if (r < extra[0]) v += 1;
    if (r < extra[1]) v += 1;
    if (r < extra[2]) v += 1;
    d.push(v);
  }
  return d;
}
def('grass_block_side_overlay', ({ rand, get }) => {
  const top = get('grass_block_top')[0];
  const c = canvas();
  // rows 0-3 always covered, ragged drips down to row 4-5
  const d = fringeDepths(rand, 4, [0.45, 0.14, 0]);
  for (let x = 0; x < N; x++) for (let y = 0; y < d[x]; y++) {
    let col = top.get(x, y);
    if (y === d[x] - 1 && y >= 4) col = shade(col, 0.88);
    c.set(x, y, col);
  }
  return c;
});
const SNOW = [0xdde8e8, 0xe9f2f2, 0xf3f9f9, 0xfbfefe, 0xffffff];
def('grass_block_snow', ({ rand, get }) => {
  const c = get('dirt')[0].clone();
  const d = fringeDepths(rand, 3, [0.6, 0.18, 0]);
  const f = equalize(field(fbm(rand, GRAINY)));
  const pal = palette(SNOW.slice(1), [15, 30, 35, 20]);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < d[x]; y++) c.set(x, y, y === d[x] - 1 ? SNOW[0] : pal(f[y * N + x]));
    c.set(x, d[x], shade(c.get(x, d[x]), 0.85));
  }
  return c;
});
def('snow', ({ rand }) => noiseTex(rand, GRAINY, SNOW, [6, 16, 30, 30, 18]));

const PODZOL = [0x4a3216, 0x5b3f1c, 0x6a4b22, 0x7a5829, 0x8a6731, 0x9b773b];
def('podzol_top', ({ rand }) => {
  const c = noiseTex(rand, FINE, PODZOL.slice(1, 5), [20, 30, 30, 20]);
  // needle litter: short diagonal strokes
  for (let k = 0; k < 26; k++) {
    const x = ri(rand, N), y = ri(rand, N), dir = rand() < 0.5 ? 1 : -1, len = 2 + ri(rand, 2);
    const col = rand() < 0.45 ? PODZOL[5] : rand() < 0.5 ? PODZOL[0] : 0x7f6a2e;
    for (let i = 0; i < len; i++) setW(c, x + i * dir, y + i, col);
  }
  return c;
});
def('podzol_side', ({ rand, get }) => {
  const c = get('dirt')[0].clone();
  const top = get('podzol_top')[0];
  const d = fringeDepths(rand, 3, [0.5, 0.2, 0.06]);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < d[x]; y++) c.set(x, y, top.get(x, y));
    c.set(x, d[x] - 1, shade(top.get(x, d[x] - 1), 0.85));
  }
  return c;
});

const PATH = [0x7d6436, 0x8b713f, 0x987e47, 0xa38a50, 0xae9559, 0xbaa265];
def('dirt_path_top', ({ rand }) => noiseTex(rand, FINE, PATH, [8, 18, 28, 24, 15, 7]));
def('dirt_path_side', ({ rand, get }) => {
  const c = get('dirt')[0].clone();
  const top = get('dirt_path_top')[0];
  const d = fringeDepths(rand, 3, [0.45, 0.12, 0]);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < d[x]; y++) c.set(x, y, top.get(x, y));
    c.set(x, d[x] - 1, shade(top.get(x, d[x] - 1), 0.8));
    c.set(x, d[x], shade(c.get(x, d[x]), 0.8));
  }
  return c;
});

function farmlandTex(rand, cols) {
  // cols: [darkest, dark, mid, light, lightest]
  const c = canvas();
  const nz = vnoise(rand, 16), lump = vnoise(rand, 8, 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ph = (y + (lump(x, y) > 0.72 ? 1 : 0)) % 4;
    let i = [3, 2, 1, 0][ph];
    if (ph === 1 || ph === 2) i += nz(x, y) > 0.75 ? 1 : nz(x, y) < 0.2 ? -1 : 0;
    else if (nz(x, y) > 0.8) i += ph === 0 ? 1 : 1;
    c.set(x, y, cols[Math.max(0, Math.min(4, i))]);
  }
  for (let i = 0; i < N; i++) {
    c.set(i, 0, cols[4]); c.set(0, i, cols[3]);
    c.set(i, 15, cols[0]); c.set(15, i, cols[1]);
  }
  return c;
}
def('farmland', ({ rand }) => farmlandTex(rand, [0x4f3521, 0x654430, 0x77533a, 0x8a6446, 0x9b7453]));
def('farmland_moist', ({ rand }) => farmlandTex(rand, [0x24160c, 0x311f12, 0x3d2818, 0x4a321f, 0x563b25]));

def('sand', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.2], [8, 8, 0.3], [16, 16, 0.5]], [0xc8b888, 0xd3c597, 0xdbcfa3, 0xe2d7ae, 0xe9e1bd], [8, 22, 34, 25, 11]);
  for (let k = 0; k < 6; k++) setW(c, ri(rand, N), ri(rand, N), 0xbfae7c);
  return c;
});
def('red_sand', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.2], [8, 8, 0.3], [16, 16, 0.5]], [0x9d4f17, 0xab5a1c, 0xb86320, 0xc26c25, 0xcd7a31], [8, 22, 34, 25, 11]);
  for (let k = 0; k < 6; k++) setW(c, ri(rand, N), ri(rand, N), 0x8e4613);
  return c;
});
def('clay', ({ rand }) => noiseTex(rand, FINE, [0x8f95a2, 0x989eab, 0xa0a6b3, 0xa8aebb, 0xb2b8c4], [8, 22, 38, 23, 9]));
def('gravel', ({ rand }) => {
  // irregular pebbles of several stone colours separated by dark grit
  const pts = scatter(rand, 30, 2.4);
  for (const p of pts) p.w = 0.7 + rand() * 0.6;
  const v = voronoi(pts);
  const cols = [
    [0x5f5a58, 0x716c6a, 0x847f7d], [0x6f6a69, 0x837e7c, 0x9a9492], [0x86817f, 0x9a9593, 0xb0abaa],
    [0x6b5f5a, 0x7f716b, 0x958780], [0x55504e, 0x676160, 0x7a7472], [0x7a7270, 0x8e8684, 0xa39b99],
  ];
  const pc = pts.map((_, i) => cols[(i * 7 + ri(rand, 3)) % cols.length]);
  const nz = vnoise(rand, 16);
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    const gap = v.d2[k] - v.d1[k];
    if (gap < 0.45 || (gap < 0.8 && nz(x, y) < 0.3)) { c.set(x, y, nz(x, y) < 0.5 ? 0x4a4645 : 0x575251); continue; }
    const cc = pc[v.id[k]];
    const upM = v.id[wrap(y - 1) * N + x] !== v.id[k], dnM = v.id[wrap(y + 1) * N + x] !== v.id[k];
    let i = 1;
    if (upM && !dnM) i = 2; else if (dnM && !upM) i = 0;
    else if (nz(x, y) > 0.8) i = 2; else if (nz(x, y) < 0.18) i = 0;
    c.set(x, y, cc[i]);
  }
  return c;
});

const MOSS = [0x3e561d, 0x4a6624, 0x56742b, 0x617f31, 0x6e8e39, 0x7e9f44];
def('moss_block', ({ rand }) => noiseTex(rand, [[4, 4, 0.25], [8, 8, 0.3], [16, 16, 0.45]], MOSS, [8, 18, 26, 24, 16, 8]));

def('terracotta', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x8e563e, 0x945b41, 0x985e43, 0x9d6247], [15, 30, 35, 20]);
  for (let k = 0; k < 6; k++) setW(c, ri(rand, N), ri(rand, N), 0x87523a);
  return c;
});

// ===========================================================================
// ORES & mineral blocks
// ===========================================================================
// Ore clusters are small hand-authored shapes: h = highlight, l = light, m = mid, d = dark.
const ORE_SHAPES = [
  ['.hl.', 'hlmd', '.md.'],
  ['hl', 'md'],
  ['.h.', 'hlm', '.md'],
  ['hl.', 'lmm', '.md'],
  ['.hl', 'hmd', 'ld.'],
  ['hlm', 'lmd'],
  ['.hl', 'lmd', 'md.'],
  ['hl', 'lm', '.d'],
  ['hl..', 'lmhl', '.dmd'],
  ['.h', 'hm', 'md'],
];
function oreTex(base, rand, { cols, count = 5, shapes = [0, 1, 2, 3, 4, 5, 6, 7], shadow = 0.7, extra = null }) {
  // cols: [highlight, light, mid, dark]
  const c = base.clone();
  const used = new Int8Array(256).fill(-1); // index into cols of each mineral pixel
  const occ = new Uint8Array(256);           // occupied incl. 1px margin
  const clusters = [];
  let guard = 0;
  while (clusters.length < count && guard++ < 600) {
    const sh = ORE_SHAPES[pick(rand, shapes)];
    const w = Math.max(...sh.map((r) => r.length)), h = sh.length;
    const x0 = 1 + ri(rand, 15 - w), y0 = 1 + ri(rand, 15 - h);
    let ok = true;
    for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) if (sh[y][x] !== '.' && occ[(y0 + y) * N + x0 + x]) { ok = false; break; }
    if (!ok) continue;
    const pal = extra && clusters.length % 2 === 1 ? extra : cols;
    const px = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = sh[y][x];
      if (ch === '.') continue;
      px.push([x0 + x, y0 + y, pal['hlmd'.indexOf(ch)]]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = x0 + x + dx, b = y0 + y + dy;
        if (a >= 0 && b >= 0 && a < N && b < N) occ[b * N + a] = 1;
      }
    }
    for (const [x, y] of px) used[y * N + x] = 1;
    clusters.push(px);
  }
  const isU = (x, y) => x >= 0 && y >= 0 && x < N && y < N && used[y * N + x] === 1;
  // drop shadow on the base (below/right of the minerals)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (isU(x, y)) continue;
    if (isU(x - 1, y) || isU(x, y - 1) || isU(x - 1, y - 1)) c.set(x, y, shade(c.get(x, y), shadow));
  }
  for (const px of clusters) for (const [x, y, col] of px) c.set(x, y, col);
  return c;
}
const ORES = {
  coal: { cols: [0x5c5c5c, 0x383838, 0x222222, 0x101010], count: 6, shapes: [0, 3, 4, 6, 8, 5] },
  iron: { cols: [0xf3d9c5, 0xd8af93, 0xaf8e77, 0x7d6352], count: 5 },
  copper: { cols: [0xf3a27a, 0xe07f4d, 0xb85d33, 0x7e3f22], extra: [0xa3e8c9, 0x5fbf97, 0x3f8f6e, 0x2a6450], count: 6 },
  gold: { cols: [0xfffdc0, 0xfcee4b, 0xf8af2b, 0xa66f10], count: 5 },
  redstone: { cols: [0xff8a8a, 0xff1a1a, 0xc20000, 0x7a0000], count: 7, shapes: [1, 2, 5, 7, 9] },
  lapis: { cols: [0x6a98f5, 0x2f5fcf, 0x1d47a6, 0x0e2a6e], count: 7, shapes: [1, 2, 3, 5, 7, 9] },
  diamond: { cols: [0xeafffb, 0x7ff6e6, 0x2ed6c6, 0x137a74], count: 5, shapes: [0, 2, 3, 4, 6] },
  emerald: { cols: [0xb5ffd0, 0x41f384, 0x17c95a, 0x007a28], count: 4, shapes: [2, 9, 7] },
};
for (const [ore, spec] of Object.entries(ORES)) {
  def(`${ore}_ore`, ({ rand, get }) => oreTex(get('stone')[0], rand, spec));
  def(`deepslate_${ore}_ore`, ({ rand, get }) => oreTex(get('deepslate')[0], rand, {
    ...spec, shadow: 0.6, cols: ore === 'coal' ? [0x777777, 0x4a4a4a, 0x2a2a2a, 0x121212] : spec.cols,
  }));
}

// Metal / gem storage blocks share a bevelled frame
function bevel(c, hi, lo, hi2 = null, lo2 = null) {
  for (let i = 0; i < N; i++) {
    c.set(i, 0, hi); c.set(0, i, hi);
    c.set(i, 15, lo); c.set(15, i, lo);
  }
  if (hi2) for (let i = 1; i < 15; i++) { c.set(i, 1, hi2); c.set(1, i, hi2); }
  if (lo2) for (let i = 1; i < 15; i++) { c.set(i, 14, lo2); c.set(14, i, lo2); }
  c.set(15, 0, mix(hi, lo, 0.5)); c.set(0, 15, mix(hi, lo, 0.5));
  return c;
}
def('iron_block', ({ rand }) => {
  const c = noiseTex(rand, [[16, 2, 0.5], [16, 16, 0.5]], [0xcfcfcf, 0xd8d8d8, 0xdedede, 0xe6e6e6], [15, 35, 35, 15]);
  for (let y = 0; y < N; y++) if (y % 5 === 3) for (let x = 2; x < 14; x++) c.set(x, y, rand() < 0.8 ? 0xc8c8c8 : 0xd0d0d0);
  bevel(c, 0xf6f6f6, 0x9e9e9e, 0xececec, 0xb6b6b6);
  return c;
});
def('gold_block', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0xeec02f, 0xf5d042, 0xf9dc55], [25, 50, 25]);
  // diagonal shine streaks
  for (const [x0, y0, len] of [[3, 7, 4], [4, 9, 6], [8, 3, 3], [9, 12, 3]]) for (let i = 0; i < len; i++) c.set(x0 + i, y0 - i, 0xfff7a0);
  bevel(c, 0xfffec2, 0xc0851a, 0xfbe56c, 0xdca527);
  return c;
});
def('diamond_block', ({ rand }) => {
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + y) & 7, v = (x - y + 16) & 7;
    let col = 0x5de3d6;
    if (u === 0 || v === 0) col = 0x3cc7bd;
    else if (u === 1 || v === 1) col = 0x8ff3ea;
    c.set(x, y, col);
  }
  for (let k = 0; k < 8; k++) c.set(2 + ri(rand, 12), 2 + ri(rand, 12), 0xc4fbf5);
  bevel(c, 0xdcfffb, 0x1f9e97, 0xa9f7ef, 0x2fb9b1);
  return c;
});
def('emerald_block', () => {
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const row = y >> 2, off = row % 2 ? 3 : 0;
    const xx = wrap(x - off) % 6, yy = y & 3;
    let col = 0x2ad66b;
    if (yy === 3 || xx === 5) col = 0x0b8a36;
    else if (yy === 0 || xx === 0) col = 0x8af7b1;
    else if (yy === 2 || xx === 4) col = 0x17b552;
    c.set(x, y, col);
  }
  bevel(c, 0xb8ffd2, 0x06662a, null, null);
  return c;
});
def('lapis_block', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.35], [8, 8, 0.3], [16, 16, 0.35]], [0x173a86, 0x1d4596, 0x2351aa, 0x2c5ec0, 0x4476d4], [10, 25, 32, 22, 11]);
  for (let k = 0; k < 8; k++) c.set(ri(rand, N), ri(rand, N), 0x6f9ae6);
  bevel(c, 0x5a86dc, 0x102d6e);
  return c;
});
def('redstone_block', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x9c1405, 0xa9180a, 0xb41d0c], [30, 40, 30]);
  for (let y = 2; y < 14; y += 4) for (let x = 2; x < 14; x += 4) {
    c.set(x, y, 0xe8341a); c.set(x + 1, y, 0xd12a12); c.set(x, y + 1, 0xd12a12); c.set(x + 1, y + 1, 0x7a0e03);
  }
  for (let k = 0; k < 10; k++) c.set(ri(rand, N), ri(rand, N), 0xc62812);
  bevel(c, 0xe0331a, 0x5e0b02);
  return c;
});
def('coal_block', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.35], [8, 8, 0.3], [16, 16, 0.35]], [0x0e0e0e, 0x161616, 0x1e1e1e, 0x282828, 0x333333], [15, 30, 30, 17, 8]);
  for (let k = 0; k < 7; k++) { const x = ri(rand, N), y = ri(rand, N); c.set(x, y, 0x4a4a4a); c.set(x + 1, y + 1, 0x0a0a0a); }
  return c;
});
def('copper_block', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0xa9573e, 0xb86448, 0xc36e51, 0xcf7c5e, 0xdd8e72], [8, 25, 34, 23, 10]);
  for (let k = 0; k < 6; k++) { const x = 2 + ri(rand, 12), y = 2 + ri(rand, 12); c.set(x, y, 0xe8a38a); c.set(x + 1, y, 0xd98a6f); }
  bevel(c, 0xe9a288, 0x8a4430, 0xd88a6d, 0x9e5038);
  return c;
});
function rawBlock(rand, cols, mortar) {
  return cobbleTex(rand, { n: 9, minD: 4.2, gap: 0.8, stones: cols, mortar, bevel: 0.32, slope: 0.07, grain: 0.15 });
}
def('raw_iron_block', ({ rand }) => rawBlock(rand, [0x7d6352, 0x97796a, 0xaf8e77, 0xc4a086, 0xd8b397, 0xe8c8ae], [0x5e4a3d, 0x6c5646]));
def('raw_gold_block', ({ rand }) => rawBlock(rand, [0xa06d10, 0xc48a17, 0xdea52a, 0xf0c03a, 0xf9d85a, 0xfff08d], [0x7a520c, 0x8c5f10]));
def('raw_copper_block', ({ rand }) => rawBlock(rand, [0x7a3f26, 0x94502f, 0xae6038, 0xc5724a, 0xd88760, 0xeba07c], [0x5b2e1b, 0x6a3721]));

def('obsidian', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.35], [8, 8, 0.3], [16, 16, 0.35]], [0x0c0a13, 0x131020, 0x1b162b, 0x241d38, 0x302647], [15, 30, 28, 18, 9]);
  // pale purple glints in short curved strokes
  for (let k = 0; k < 7; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    setW(c, x, y, 0x5b4687); setW(c, x + 1, y, 0x44356a);
    if (rand() < 0.6) setW(c, x - 1, y + 1, 0x3a2d59);
    if (rand() < 0.4) setW(c, x + 1, y - 1, 0x7a64a8);
  }
  return c;
});
def('bedrock', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.35], [8, 8, 0.3], [16, 16, 0.35]], [0x1c1c1c, 0x333333, 0x4d4d4d, 0x666666, 0x828282, 0xa0a0a0], [12, 20, 22, 20, 16, 10]);
  return c;
});
def('glowstone', ({ rand }) => {
  const pts = scatter(rand, 13, 3.4);
  for (const p of pts) p.w = 0.8 + rand() * 0.4;
  const v = voronoi(pts);
  const pal = palette([0x6e4e2a, 0x8c6536, 0xb2823f, 0xd4a14f, 0xefc46a, 0xfde19a, 0xfff6cf], [12, 14, 18, 20, 18, 12, 6]);
  const nz = vnoise(rand, 16);
  const tone = pts.map(() => rand() * 0.25);
  const c = canvas();
  for (let k = 0; k < 256; k++) {
    const edge = clamp01((v.d2[k] - v.d1[k]) / 2.4);
    const t = clamp01(edge * 0.85 + tone[v.id[k]] + (nz(k & 15, k >> 4) - 0.5) * 0.25 - 0.05);
    c.set(k & 15, k >> 4, pal(t));
  }
  return c;
});
def('amethyst_block', ({ rand }) => {
  const pts = scatter(rand, 10, 3.8);
  const v = voronoi(pts);
  const nrm = pts.map(() => { const a = rand() * TAU; return [Math.cos(a), Math.sin(a), 0.35 + rand() * 0.4]; });
  const pal = palette([0x4d3073, 0x603e92, 0x7652ad, 0x8a64c3, 0xa27dd6, 0xc19de9, 0xe4c9fb], [8, 14, 20, 22, 18, 12, 6]);
  const c = canvas();
  for (let k = 0; k < 256; k++) {
    const [nx, ny, b] = nrm[v.id[k]];
    let t = b + (v.ox[k] * nx + v.oy[k] * ny) * 0.09;
    if (v.d2[k] - v.d1[k] < 0.6) t = (nx + ny < 0) ? 0.95 : 0.05;
    c.set(k & 15, k >> 4, pal(clamp01(t)));
  }
  return c;
});

// ===========================================================================
// SANDSTONE
// ===========================================================================
const SSTONE = [0xbfae7b, 0xcdbd8a, 0xd8cb9b, 0xe0d5a8, 0xe8dfb8];
def('sandstone_top', ({ rand }) => noiseTex(rand, FINE, SSTONE.slice(1), [12, 40, 38, 10]));
def('sandstone_bottom', ({ rand }) => {
  const c = noiseTex(rand, GRAINY, SSTONE, [8, 20, 36, 26, 10]);
  for (let k = 0; k < 10; k++) setW(c, ri(rand, N), ri(rand, N), 0xb09f6d);
  return c;
});
def('sandstone', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16), band = vnoise(rand, 4, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = nz(x, y);
    let col;
    if (y < 3) col = n > 0.8 ? SSTONE[4] : n < 0.2 ? SSTONE[2] : SSTONE[3];
    else if (y === 3) col = SSTONE[0];
    else if (y < 12) {
      const stripe = (y % 2 === 0) ? 0.12 : -0.08;
      const t = n * 0.5 + band(x, y) * 0.5 + stripe;
      col = t > 0.7 ? SSTONE[3] : t > 0.45 ? SSTONE[2] : t > 0.25 ? SSTONE[1] : SSTONE[0];
    } else if (y === 12) col = SSTONE[1];
    else col = n > 0.75 ? SSTONE[3] : n < 0.3 ? SSTONE[0] : n < 0.5 ? SSTONE[1] : SSTONE[2];
    c.set(x, y, col);
  }
  return c;
});
def('cut_sandstone', ({ rand }) => {
  const c = noiseTex(rand, FINE, SSTONE.slice(2, 4), [50, 50]);
  for (let i = 0; i < N; i++) {
    for (const y of [0, 8]) c.set(i, y, SSTONE[4]);
    for (const y of [7, 15]) c.set(i, y, SSTONE[0]);
    c.set(0, i, SSTONE[4]); c.set(15, i, SSTONE[0]);
  }
  c.set(0, 7, SSTONE[1]); c.set(0, 15, SSTONE[1]); c.set(15, 0, SSTONE[1]); c.set(15, 8, SSTONE[1]);
  return c;
});

// ===========================================================================
// WOOD: planks, logs, log tops
// ===========================================================================
function planksTex(rand, P) {
  // P: [seam, dark, midDark, mid, light, lighter]
  const c = canvas();
  const joints = [];
  let prev = -10;
  for (let b = 0; b < 4; b++) {
    let j, g = 0;
    do { j = ri(rand, 16); } while (g++ < 50 && (Math.abs(tdx(j, prev)) < 5 || (b === 3 && Math.abs(tdx(j, joints[0])) < 4)));
    joints.push(j); prev = j;
  }
  for (let b = 0; b < 4; b++) {
    const y0 = b * 4;
    const tone = ri(rand, 3) - 1;
    const grain = vnoise(rand, 8, 16), streak = vnoise(rand, 4, 16);
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < N; x++) {
      if (y === y0 + 3) { c.set(x, y, rand() < 0.85 ? P[0] : P[1]); continue; }
      let i = 3 + tone + Math.round((grain(x, y) - 0.5) * 2.2 + (streak(x, y) - 0.5) * 1.6);
      if (y === y0) i += 1;
      c.set(x, y, P[Math.max(1, Math.min(5, i))]);
    }
    const j = joints[b];
    for (let y = y0; y < y0 + 3; y++) { c.set(j, y, P[0]); c.set(wrap(j + 1), y, P[Math.min(5, 4 + (y === y0 ? 1 : 0))]); }
    // a couple of dark grain dashes
    for (let k = 0; k < 2; k++) {
      const x = ri(rand, N), y = y0 + 1 + ri(rand, 2), len = 2 + ri(rand, 3);
      for (let i = 0; i < len; i++) if (wrap(x + i) !== j) setW(c, x + i, y, P[1]);
    }
  }
  return c;
}
const WOOD = {
  oak: {
    stripped: [0x8f6f3f, 0x9f7e4a, 0xae8c55, 0xb8975e, 0xc2a168, 0xcdac74],
    planks: [0x6e5530, 0x866a3f, 0x957748, 0xa2834f, 0xb08f59, 0xbc9a62],
    bark: [0x3b2e1c, 0x4c3c25, 0x5f4b2e, 0x6d5635, 0x7b6340, 0x8c7249],
    ring: [0x8b6c40, 0x9d7d4c, 0xae8c57, 0xbd9c63],
    sapling: { leaves: [0x245e14, 0x33801e, 0x459f2a, 0x62bd3c], trunk: [0x7a5c33, 0x5a4424], shape: 'round' },
  },
  spruce: {
    stripped: [0x5a4024, 0x664a2b, 0x735432, 0x7e5e39, 0x886741, 0x93714a],
    planks: [0x3f2b16, 0x5a3f22, 0x644727, 0x6f502c, 0x7b5a33, 0x85633a],
    bark: [0x1f1409, 0x2a1b0c, 0x352412, 0x3f2c17, 0x4b361d, 0x5a4226],
    ring: [0x5a3f22, 0x6a4c2a, 0x775733, 0x86643b],
    sapling: { leaves: [0x1b3a1d, 0x28542a, 0x386c38, 0x4c8548], trunk: [0x4d3620, 0x352412], shape: 'cone' },
  },
  birch: {
    stripped: [0xa99665, 0xb6a371, 0xc2af7c, 0xccb986, 0xd5c390, 0xdecd9b],
    planks: [0x8f7d51, 0xae9c66, 0xbba970, 0xc5b47b, 0xd0c086, 0xd9cb92],
    bark: [0x2e2a27, 0x9e9e98, 0xc2c2bb, 0xd6d6d0, 0xe4e4df, 0xf0f0ec],
    ring: [0xae9c66, 0xc1ae78, 0xcfbe86, 0xdccd95],
    sapling: { leaves: [0x3f6a1f, 0x5a8a2c, 0x76a83a, 0x98c455], trunk: [0xdadad4, 0x4a4643], shape: 'round' },
  },
  jungle: {
    stripped: [0x86633a, 0x967043, 0xa57d4c, 0xb08855, 0xbb925e, 0xc59d68],
    planks: [0x6b4530, 0x8a5d40, 0x956647, 0xa0714e, 0xac7c57, 0xb6865f],
    bark: [0x2d2409, 0x3d320f, 0x4c3f15, 0x58491a, 0x665520, 0x756429],
    ring: [0x8d6038, 0x9e6f43, 0xaf7e4e, 0xbd8c58],
    sapling: { leaves: [0x1c5a12, 0x2a7a1a, 0x3a9a26, 0x57b83a], trunk: [0x6a5620, 0x4c3f15], shape: 'jungle' },
  },
  acacia: {
    stripped: [0x8b4327, 0x9b4c2d, 0xaa5634, 0xb65f3b, 0xc26944, 0xcc744e],
    planks: [0x72381b, 0x93492a, 0xa0512e, 0xab5a33, 0xb86339, 0xc26c3f],
    bark: [0x3a3631, 0x4a4540, 0x57524b, 0x645e56, 0x716a61, 0x807970],
    ring: [0x974a26, 0xa8552e, 0xb76037, 0xc46c40],
    sapling: { leaves: [0x4a6614, 0x61821c, 0x7a9d26, 0x98b83a], trunk: [0x6e675d, 0x4a4540], shape: 'flat' },
  },
  dark_oak: {
    stripped: [0x3e2d1a, 0x4a3620, 0x563f26, 0x61482c, 0x6b5033, 0x76593a],
    planks: [0x28190a, 0x39240f, 0x3f2913, 0x472f17, 0x52371c, 0x5b3f21],
    bark: [0x1a1209, 0x251a0e, 0x2f2213, 0x3a2a18, 0x44321d, 0x503b23],
    ring: [0x3f2a15, 0x4b331b, 0x573c20, 0x634527],
    sapling: { leaves: [0x173d0f, 0x215416, 0x2e6b1f, 0x40842c], trunk: [0x4a361e, 0x2f2213], shape: 'round' },
  },
};

function barkTex(rand, cols, crev = 7) {
  const c = noiseTex(rand, [[16, 2, 0.5], [16, 4, 0.25], [16, 16, 0.25]], cols.slice(0, 5), [8, 22, 34, 25, 11]);
  for (let k = 0; k < crev; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 3 + ri(rand, 6);
    for (let i = 0; i < len; i++) setW(c, x, y + i, cols[0]);
    for (let i = 1; i < len - 1; i++) if (rand() < 0.65) setW(c, x + 1, y + i, cols[4]);
  }
  return c;
}
function birchBark(rand, cols) {
  const c = noiseTex(rand, [[16, 2, 0.4], [16, 16, 0.6]], cols.slice(2), [12, 30, 38, 20]);
  const nMarks = 13;
  for (let k = 0; k < nMarks; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 2 + ri(rand, 4), h = rand() < 0.3 ? 2 : 1;
    for (let i = 0; i < len; i++) for (let j = 0; j < h; j++) {
      const edge = i === 0 || i === len - 1;
      setW(c, x + i, y + j, edge && rand() < 0.6 ? 0x57524e : cols[0]);
    }
  }
  for (let k = 0; k < 6; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, cols[1]); setW(c, x, y + 1, cols[1]); }
  return c;
}
function logTopTex(rand, bark, ring) {
  const c = canvas();
  const wob = vnoise(rand, 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x === 0 || y === 0 || x === 15 || y === 15) { c.set(x, y, bark.get(x, y)); continue; }
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.7 + Math.hypot(dx, dy) * 0.3 + (wob(x, y) - 0.5) * 0.8;
    const r = (d + 0.35) / 2.1;
    const fr = r - Math.floor(r);
    let col = fr < 0.3 ? ring[0] : fr < 0.55 ? ring[1] : fr < 0.8 ? ring[2] : ring[3];
    if (x === 1 || y === 1 || x === 14 || y === 14) col = fr < 0.5 ? ring[1] : ring[2];
    c.set(x, y, col);
  }
  // shaded inner edge next to the bark
  for (let i = 1; i < 15; i++) { c.set(i, 14, shade(c.get(i, 14), 0.9)); c.set(14, i, shade(c.get(14, i), 0.9)); }
  return c;
}
for (const [w, W] of Object.entries(WOOD)) {
  def(`${w}_planks`, ({ rand }) => planksTex(rand, W.planks));
  def(`${w}_log`, ({ rand }) => (w === 'birch' ? birchBark(rand, W.bark) : barkTex(rand, W.bark, w === 'acacia' ? 5 : 7)));
  def(`${w}_log_top`, ({ rand, get }) => logTopTex(rand, get(`${w}_log`)[0], W.ring));
}

// ===========================================================================
// LEAVES (grayscale, cutout)
// ===========================================================================
// Leaf shapes: h highlight, l light, m mid, d dark (shadow side).
const LEAF_SHAPES = [
  ['hl', 'md'],
  ['hl.', 'lmd'],
  ['.hl', 'hmd', 'md.'],
  ['hl', 'lm', '.d'],
  ['h.', 'lm', 'md'],
  ['.h.', 'hlm', '.md'],
  ['hll', 'mmd'],
  ['.hl', 'lmm', 'md.'],
];
const BIG_LEAF_SHAPES = [
  ['.hl.', 'hllm', 'lmmd', '.md.'],
  ['hll.', 'lmmd', '.md.'],
  ['.hh.', 'hlmm', 'lmmd', '.dd.'],
  ['hl..', 'lmhl', '.dmd'],
];
function leavesTex(rand, { n = 40, vals, holeP = 0.55, shapes = LEAF_SHAPES, extraHoles = 0 }) {
  // vals: [gap, dark, mid, light, highlight]
  const cov = new Int8Array(256).fill(-1);
  const idx = { d: 1, m: 2, l: 3, h: 4 };
  for (let i = 0; i < n; i++) {
    const sh = pick(rand, shapes);
    const flip = rand() < 0.35;
    const x0 = ri(rand, N), y0 = ri(rand, N);
    for (let y = 0; y < sh.length; y++) for (let x = 0; x < sh[y].length; x++) {
      const ch = sh[y][flip ? sh[y].length - 1 - x : x];
      if (ch === '.') continue;
      let v = idx[ch];
      if (flip && (ch === 'h' || ch === 'l') && rand() < 0.4) v -= 1;
      cov[wrap(y0 + y) * N + wrap(x0 + x)] = v;
    }
  }
  const c = canvas();
  for (let k = 0; k < 256; k++) {
    let s = cov[k];
    if (s < 0) { if (rand() < holeP) continue; s = 0; }
    else if (extraHoles && rand() < extraHoles) continue;
    c.set(k & 15, k >> 4, gray(vals[s]));
  }
  return c;
}
function needleLeaves(rand, vals, n = 52, holeP = 0.5) {
  const cov = new Int8Array(256).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = ri(rand, N), y = ri(rand, N), len = 3 + ri(rand, 2);
    const dx = rand() < 0.5 ? 1 : -1, steep = rand() < 0.5;
    for (let k = 0; k < len; k++) {
      const px = x + (steep ? (k >> 1) * dx : k * dx), py = y + (steep ? k : (k >> 1));
      cov[wrap(py) * N + wrap(px)] = k === 0 ? 4 : k === len - 1 ? 1 : (k === 1 ? 3 : 2);
    }
  }
  const c = canvas();
  for (let k = 0; k < 256; k++) {
    let s = cov[k];
    if (s < 0) { if (rand() < holeP) continue; s = 0; }
    c.set(k & 15, k >> 4, gray(vals[s]));
  }
  return c;
}
def('oak_leaves', ({ rand }) => leavesTex(rand, { n: 44, vals: [54, 92, 124, 158, 192], holeP: 0.5 }));
def('dark_oak_leaves', ({ rand }) => leavesTex(rand, { n: 50, vals: [50, 86, 118, 150, 184], holeP: 0.42 }));
def('acacia_leaves', ({ rand }) => leavesTex(rand, { n: 38, vals: [58, 96, 128, 162, 196], holeP: 0.62 }));
def('jungle_leaves', ({ rand }) => leavesTex(rand, { n: 24, vals: [50, 90, 124, 158, 194], holeP: 0.4, shapes: BIG_LEAF_SHAPES }));
def('birch_leaves', ({ rand }) => leavesTex(rand, { n: 50, vals: [62, 100, 132, 166, 198], holeP: 0.55, shapes: LEAF_SHAPES.slice(0, 5) }));
def('spruce_leaves', ({ rand }) => needleLeaves(rand, [46, 80, 110, 140, 172]));

// ===========================================================================
// GLASS, ICE
// ===========================================================================
function glassFrameColor(x, y) {
  const corner = (x === 0 || x === 15) && (y === 0 || y === 15);
  if (corner) return 0xa9ccd4;
  if (y === 0 || x === 0) return 0xe6f5f8;
  return 0xbad9df;
}
def('glass', () => {
  const c = canvas();
  for (let i = 0; i < N; i++) {
    c.set(i, 0, glassFrameColor(i, 0)); c.set(0, i, glassFrameColor(0, i));
    c.set(i, 15, glassFrameColor(i, 15)); c.set(15, i, glassFrameColor(15, i));
  }
  const streaks = [[[2, 5], [3, 4], [4, 3], [5, 2]], [[2, 7], [3, 6]], [[4, 6], [5, 5], [6, 4], [7, 3]], [[11, 13], [12, 12], [13, 11]]];
  for (const s of streaks) for (const [x, y] of s) c.set(x, y, [236, 248, 250, 255]);
  return c;
});
def('glass_pane_top', () => {
  const c = canvas();
  for (let y = 0; y < N; y++) { c.set(7, y, 0xe6f5f8); c.set(8, y, 0xbad9df); }
  return c;
});
def('ice', ({ rand }) => {
  const c = canvas();
  const f = equalize(field(fbm(rand, FINE)));
  const pal = palette([[112, 156, 236, 165], [122, 166, 242, 170], [134, 176, 248, 172], [148, 188, 252, 176]], [15, 35, 35, 15]);
  paint(c, f, pal);
  for (const [x0, y0, len] of [[1, 6, 5], [6, 14, 7], [9, 5, 4], [3, 12, 3], [11, 11, 4]]) {
    for (let i = 0; i < len; i++) setW(c, x0 + i, y0 - i, [196, 222, 255, 190]);
  }
  return c;
});
def('packed_ice', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x7ea2e8, 0x88acef, 0x92b6f5, 0x9ec0fa], [15, 35, 35, 15]);
  for (const [x0, y0, len, col] of [[0, 4, 5, 0x6e93dd], [7, 9, 6, 0x6e93dd], [3, 15, 4, 0x6e93dd], [10, 3, 4, 0xb6d0ff], [2, 11, 4, 0xb6d0ff], [12, 14, 3, 0xb6d0ff]]) {
    for (let i = 0; i < len; i++) setW(c, x0 + i, y0 - i, col);
  }
  return c;
});

// ===========================================================================
// WOOL
// ===========================================================================
const WOOL = {
  white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3aafd9, yellow: 0xf8c627, lime: 0x70b919,
  pink: 0xed8dac, gray: 0x3e4447, light_gray: 0x8e8e86, cyan: 0x158991, purple: 0x792aac, blue: 0x35399d,
  brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519,
};
// One shared fibrous pattern (quantised to 5 steps), dyed per colour.
let woolSteps = null;
function getWoolSteps() {
  if (woolSteps) return woolSteps;
  const rand = seeded('wool_pattern');
  // knitted "V" stitches (4x4, columns offset by half a stitch) blurred by fibre noise
  const STITCH = [
    [0.9, 0.35, 0.35, 0.9],
    [0.6, 1.0, 1.0, 0.6],
    [0.3, 0.7, 0.7, 0.3],
    [0.05, 0.3, 0.3, 0.05],
  ];
  const tone = Array.from({ length: 16 }, () => (rand() - 0.5) * 0.5);
  const nz = vnoise(rand, 16);
  const f = field((x, y) => {
    const col = x >> 2, yy = y + (col & 1 ? 2 : 0);
    const st = STITCH[yy & 3][x & 3];
    return st * 0.7 + tone[col * 4 + ((yy >> 2) & 3)] * 0.4 + (nz(x, y) - 0.5) * 0.62;
  });
  const eq = equalize(f);
  woolSteps = Array.from(eq, (t) => (t < 0.1 ? -2 : t < 0.33 ? -1 : t < 0.7 ? 0 : t < 0.91 ? 1 : 2));
  return woolSteps;
}
for (const [name, col] of Object.entries(WOOL)) {
  def(`${name}_wool`, () => {
    const steps = getWoolSteps();
    const base = rgb(col);
    const lum = (base[0] * 0.3 + base[1] * 0.59 + base[2] * 0.11) / 255;
    const c = canvas();
    for (let k = 0; k < 256; k++) {
      const s = steps[k];
      const mul = 1 + s * (lum > 0.8 ? 0.045 : 0.07);
      const add = s * (lum < 0.15 ? 6 : 2);
      c.set(k & 15, k >> 4, [base[0] * mul + add, base[1] * mul + add, base[2] * mul + add, 255]);
    }
    return c;
  });
}

// ===========================================================================
// PLANTS (cutout sprites)
// ===========================================================================
const G = { s: 0x3d7a1f, S: 0x2b5a15, l: 0x3f8a26, L: 0x62b43a };
function flower(rows, extra) { return sprite(rows, { ...G, ...extra }); }
def('dandelion', () => flower([
  '................',
  '................',
  '................',
  '................',
  '................',
  '......yYy.......',
  '.....yYYYy......',
  '.....YYOYY......',
  '.....yYYOy......',
  '......yyo.......',
  '.......s........',
  '.......s..L.....',
  '..LL...s.LL.....',
  '...lL..sLl......',
  '....lllsl.......',
  '.......s........',
], { y: 0xf2c61b, Y: 0xfff04f, O: 0xf9b21c, o: 0xc98a10 }));
def('poppy', () => flower([
  '................',
  '................',
  '................',
  '.....rRRr.......',
  '....rRRRRr......',
  '...rRRkkRRr.....',
  '...rRkKkkRr.....',
  '....rRkkRr......',
  '.....rrrr.......',
  '.......s........',
  '.......s........',
  '....L..s........',
  '....lL.s..LL....',
  '.....lls.Ll.....',
  '.......sll......',
  '.......s........',
], { r: 0xb0151b, R: 0xe8322c, k: 0x262410, K: 0x55521e }));
def('blue_orchid', () => flower([
  '................',
  '................',
  '.....bB.........',
  '....bBBb...bB...',
  '.....bD...bBBb..',
  '.bB...s....bD...',
  'bBBb..s....s....',
  '.bD...s...s.....',
  '..s...s..s......',
  '...s..s.s.......',
  '....s.ss........',
  '.....ss.........',
  '..LL..s...LL....',
  '...lL.s..Ll.....',
  '....llsll.......',
  '......s.........',
], { b: 0x2f9fe3, B: 0x86d8fa, D: 0x1a6db3 }));
def('allium', () => flower([
  '................',
  '......pPp.......',
  '.....pPWPp......',
  '....pPPpPPp.....',
  '....PpPpPpP.....',
  '....dpPpPpd.....',
  '.....dpppd......',
  '......ddd.......',
  '.......s........',
  '.......s........',
  '.......s........',
  '.......s........',
  '.......s........',
  '....L..s..L.....',
  '.....lLsLl......',
  '.......s........',
], { p: 0xa964d8, P: 0xd29ef3, W: 0xf0d6ff, d: 0x7a3fa8 }));
def('azure_bluet', () => flower([
  '................',
  '................',
  '..w.......w.....',
  '.wYw.....wYw....',
  '..w...w...w.....',
  '..s..wYw..s.....',
  '..s...w...s.....',
  '...s..s..s......',
  '...s..s..s..w...',
  '..w.s.s.s..wYw..',
  '.wYws.s.s...w...',
  '..w..sss...s....',
  '......s...s.....',
  '......s..s......',
  '......sss.......',
  '......s.........',
], { w: 0xe6ecee, Y: 0xf0cf3c, s: 0x5a9c38 }));
function tulip(P, p, d) {
  return () => flower([
    '................',
    '................',
    '................',
    '.....P.P.P......',
    '.....PpPpP......',
    '.....pPpPp......',
    '.....pPPpp......',
    '......ddd.......',
    '.......s........',
    '.......s........',
    '..L....s....L...',
    '..LL...s...LL...',
    '...Ll..s..lL....',
    '....ll.s.ll.....',
    '.....llsll......',
    '.......s........',
  ], { P, p, d });
}
def('red_tulip', tulip(0xee3d2c, 0xbd2012, 0x8a1709));
def('orange_tulip', tulip(0xf5a13c, 0xdd7016, 0xa9500c));
def('white_tulip', tulip(0xf4f4f4, 0xd5dada, 0xaab2b2));
def('pink_tulip', tulip(0xf5bddb, 0xe38cba, 0xc06494));
def('oxeye_daisy', () => flower([
  '................',
  '................',
  '.......w........',
  '....w.wWw.w.....',
  '.....wwwww......',
  '....wwYYYww.....',
  '...wWwYOYwWw....',
  '....wwYYYww.....',
  '.....wwwww......',
  '....w.wsw.w.....',
  '.......s........',
  '.......s........',
  '...L...s...L....',
  '....Ll.s.lL.....',
  '.....llsll......',
  '.......s........',
], { w: 0xf6f6f6, W: 0xcfd5d5, Y: 0xf7d52f, O: 0xd8a01a }));
def('cornflower', () => flower([
  '................',
  '................',
  '......b..b......',
  '....b.bBBb.b....',
  '.....bBDDBb.....',
  '....bBDddDBb....',
  '.....bBDDBb.....',
  '....b..bb..b....',
  '.......s........',
  '.......s........',
  '.......s..L.....',
  '..L....s.LL.....',
  '..lL...sLl......',
  '...ll..sl.......',
  '....llls........',
  '.......s........',
], { b: 0x4f73e6, B: 0x86a6fa, D: 0x2d48bd, d: 0x1b2a86 }));
def('lily_of_the_valley', () => flower([
  '................',
  '................',
  '......sss.......',
  '.....s...s......',
  '...ss.....s.....',
  '..s..s....s.ww..',
  '.wW.wW...sswWw..',
  '.ww.ww....s.w...',
  '..L.......s..L..',
  '..LL......s.LL..',
  '..LlL.....sLlL..',
  '...LlL...s.Ll...',
  '...Lll..ssLll...',
  '....lll.slll....',
  '.....lllsll.....',
  '........s.......',
], { w: 0xf4f4f4, W: 0xd2d8d8, s: 0x4d8f2a }));
def('brown_mushroom', () => sprite([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....hhhhh......',
  '....hBBBBBb.....',
  '...hBBBBBBBb....',
  '...dbbbbbbbd....',
  '......wWs.......',
  '......wWs.......',
  '......wWs.......',
  '......wWs.......',
  '................',
], { h: 0xc9a17d, B: 0x9a7255, b: 0x7c5a41, d: 0x5c4230, w: 0xe6dac8, W: 0xcdbfa9, s: 0xa6977f }));
def('red_mushroom', () => sprite([
  '................',
  '................',
  '................',
  '................',
  '......rrrr......',
  '....rRRoRRr.....',
  '...rRoRRRRor....',
  '...rRRRRoRRr....',
  '...rRoRRRRRr....',
  '....ddddddd.....',
  '......wWs.......',
  '......wWs.......',
  '......wWs.......',
  '......wWs.......',
  '................',
  '................',
], { r: 0xa3130f, R: 0xdf2520, o: 0xf3e6e2, d: 0x6c0e0b, w: 0xe6dac8, W: 0xcdbfa9, s: 0xa6977f }));

// ---- saplings ----
function saplingTex(rand, { leaves, trunk, shape }) {
  const c = canvas();
  const nz = vnoise(rand, 16), blob = vnoise(rand, 8);
  const leaf = (x, y, t) => c.set(x, y, leaves[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
  // trunk
  const tx = 7;
  const trunkTop = shape === 'flat' ? 5 : shape === 'cone' ? 3 : 7;
  for (let y = trunkTop; y < N; y++) {
    let x = tx;
    if (shape === 'flat') x = y < 9 ? tx + (y < 7 ? 1 : 0) : tx;
    c.set(x, y, trunk[0]); c.set(x + 1, y, trunk[1]);
    if (shape === 'round' && trunk[0] === 0xdadad4 && y % 3 === 1) c.set(x, y, 0x3a3633);
  }
  if (shape === 'round' || shape === 'jungle') {
    const cy = shape === 'jungle' ? 6 : 5.5, rx = shape === 'jungle' ? 6.2 : 5.3, ry = shape === 'jungle' ? 5 : 4.8;
    for (let y = 0; y < 12; y++) for (let x = 0; x < N; x++) {
      const dx = (x + 0.5 - 8) / rx, dy = (y + 0.5 - cy) / ry;
      const e = dx * dx + dy * dy + (blob(x, y) - 0.5) * 0.9;
      if (e > 1) continue;
      if (nz(x, y) < 0.14) continue;
      const t = 0.55 - (dx + dy) * 0.35 + (nz(x, y) - 0.5) * 0.7 - (e > 0.7 ? 0.2 : 0);
      leaf(x, y, clamp01(t));
    }
    if (shape === 'jungle') {
      // a couple of big drooping leaves
      for (const [x0, dir] of [[3, -1], [12, 1]]) for (let i = 0; i < 4; i++) { c.set(x0 + dir * (i >> 1), 9 + i, leaves[i < 2 ? 1 : 0]); }
    }
  } else if (shape === 'cone') {
    const tiers = [[1, 4, 3], [4, 8, 5], [8, 12, 6.5]];
    for (const [y0, y1, w] of tiers) for (let y = y0; y < y1; y++) {
      const half = 0.8 + (w - 0.8) * (y - y0) / Math.max(1, y1 - y0 - 1);
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - 8;
        if (Math.abs(dx) > half) continue;
        if (nz(x, y) < 0.1) continue;
        const t = 0.6 - dx / (half * 3) - (y - y0) / 8 + (nz(x, y) - 0.5) * 0.5;
        leaf(x, y, clamp01(t));
      }
    }
  } else if (shape === 'flat') {
    for (let y = 1; y < 7; y++) for (let x = 0; x < N; x++) {
      const dx = (x + 0.5 - 8) / 7.2, dy = (y + 0.5 - 3.8) / 2.6;
      const e = dx * dx + dy * dy + (blob(x, y) - 0.5) * 0.8;
      if (e > 1 || nz(x, y) < 0.15) continue;
      leaf(x, y, clamp01(0.6 - dy * 0.35 - dx * 0.1 + (nz(x, y) - 0.5) * 0.6));
    }
  }
  return c;
}
for (const [w, W] of Object.entries(WOOD)) {
  if (w === 'acacia') continue;
  def(`${w}_sapling`, ({ rand }) => saplingTex(rand, W.sapling));
}
def('acacia_sapling', () => {
  const [d, l, L, h] = WOOD.acacia.sapling.leaves;
  const [t, T] = WOOD.acacia.sapling.trunk;
  return sprite([
    '................',
    '................',
    '....llL..lLl....',
    '..lLLhLllLhLLl..',
    '.lLhLLlLLLLlhLl.',
    '.dlLlldLlLLdLld.',
    '..ddl.ddl.dld...',
    '.....t...t......',
    '......t.t.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
  ], { d, l, L, h, t, T });
});

// ---- grass & fern & other cross plants ----
def('grass', ({ rand }) => {
  const c = canvas();
  const blades = [];
  for (let x = 0; x < N; x++) {
    if (rand() < 0.15) continue;
    const center = 1 - Math.abs(x - 7.5) / 8;
    blades.push({ x, h: 4 + ri(rand, 6) + Math.round(center * 5), lean: rand() < 0.3 ? (rand() < 0.5 ? -1 : 1) : 0, base: (x & 1 ? 104 : 128) + ri(rand, 22) });
  }
  // draw shorter blades last so they sit in front
  blades.sort((a, b) => b.h - a.h);
  for (const b of blades) {
    for (let k = 0; k < b.h; k++) {
      const y = 15 - k;
      const x = b.x + (k >= b.h - 2 ? b.lean : 0);
      c.set(x, y, gray(Math.min(212, b.base + Math.round(k * 5.5))));
    }
  }
  return c;
});
def('fern', ({ rand }) => {
  const c = canvas();
  const fronds = [
    { x: 7.5, ang: -0.12, len: 15, curl: -0.02 },
    { x: 8.5, ang: 0.42, len: 12, curl: 0.07 },
    { x: 7.5, ang: -0.62, len: 11, curl: -0.08 },
    { x: 8.5, ang: 0.95, len: 8, curl: 0.12 },
    { x: 7.5, ang: -1.1, len: 7, curl: -0.12 },
  ];
  const stems = [];
  for (const f of fronds) {
    let x = f.x, y = 15.5, a = f.ang;
    for (let i = 0; i < f.len; i++) {
      const px = Math.floor(x), py = Math.floor(y);
      if (py < 0) break;
      stems.push([px, py, 112 + i * 3]);
      if (i >= 2 && i < f.len - 1) {
        const lx = Math.cos(a), ly = Math.sin(a);
        const w = i < f.len * 0.75 ? 2 : 1;
        for (let k = 1; k <= w; k++) {
          const v = 150 + ri(rand, 30) + (f.len - i) * 2;
          c.set(Math.floor(x + lx * k), Math.floor(y + ly * k + (k === 2 ? 0.6 : 0)), gray(Math.min(215, v)));
          c.set(Math.floor(x - lx * k), Math.floor(y - ly * k + (k === 2 ? 0.6 : 0)), gray(Math.min(200, v - 22)));
        }
      }
      x += Math.sin(a); y -= Math.cos(a); a += f.curl * (1 + i / f.len);
    }
  }
  for (const [x, y, v] of stems) c.set(x, y, gray(v));
  return c;
});
def('dead_bush', ({ rand }) => {
  const c = canvas();
  const cols = [0x6b4a1e, 0x8a6534, 0x4d3413];
  const branch = (x, y, dx, len, depth) => {
    for (let i = 0; i < len; i++) {
      c.set(Math.round(x), Math.round(y), cols[depth === 0 ? 0 : (i % 3 === 0 ? 2 : 1)]);
      if (depth < 2 && i > 1 && rand() < 0.28) branch(x, y, dx + (rand() < 0.5 ? -0.8 : 0.8), 2 + ri(rand, 4), depth + 1);
      x += dx; y -= 1;
      if (x < 0 || x > 15 || y < 0) break;
    }
  };
  branch(7, 15, 0, 3, 0);
  branch(7, 12, -0.7, 7, 1); branch(8, 12, 0.7, 7, 1); branch(7, 12, -0.2, 8, 1); branch(8, 13, 1.2, 4, 1); branch(7, 13, -1.3, 4, 1);
  return c;
});
def('sugar_cane', ({ rand }) => {
  const c = canvas();
  for (const [x0, off] of [[2, 1], [7, 3], [12, 0]]) {
    for (let y = 0; y < N; y++) {
      const node = (y + off) % 6 === 0;
      c.set(x0, y, gray(node ? 170 : 210));
      c.set(x0 + 1, y, gray(node ? 140 : 180));
      if (node && y > 0) { c.set(x0, y - 1, gray(230)); }
    }
    // leaves from some nodes
    for (let y = 0; y < N; y++) if ((y + off) % 6 === 0 && rand() < 0.7) {
      const dir = rand() < 0.5 ? -1 : 1, bx = dir < 0 ? x0 - 1 : x0 + 2;
      c.set(bx, y + 1, gray(175)); c.set(bx + dir, y + 2, gray(160));
      if (rand() < 0.5) c.set(bx + dir * 2, y + 3, gray(150));
    }
  }
  return c;
});
def('seagrass', () => {
  const c = canvas();
  const cols = [0x1f6a2a, 0x2f8a33, 0x44a63e, 0x62c254];
  for (const [x0, h, ph] of [[2, 12, 0.3], [5, 15, 1.4], [8, 13, 2.6], [11, 16, 0.9], [13, 11, 2.0]]) {
    for (let k = 0; k < h; k++) {
      const y = 15 - k;
      const x = Math.round(x0 + Math.sin(k * 0.55 + ph) * 1.1);
      const t = k / h;
      c.set(x, y, cols[Math.min(3, 1 + Math.floor(t * 3))]);
      if (k < h - 3) c.set(x + 1, y, cols[0]);
    }
  }
  return c;
});
def('lily_pad', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
    const r = Math.hypot(dx, dy);
    if (r > 7.4) continue;
    const ang = Math.atan2(dy, dx);
    if (ang > 0.35 && ang < 0.95 && r > 1.2) continue; // notch
    let v = 170 + (nz(x, y) - 0.5) * 30;
    const spoke = Math.abs(Math.sin(ang * 4.5));
    if (spoke < 0.18 && r > 1.5) v = 138;
    if (r > 6.4) v = 128;
    c.set(x, y, gray(Math.round(v)));
  }
  return c;
});
def('cobweb', () => {
  const c = canvas();
  const col = [222, 222, 222, 255], col2 = [242, 242, 242, 255];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let i = 0; i < 8; i++) c.set(7 + (dx > 0 ? i + 1 : dx < 0 ? -i : 0), 7 + (dy > 0 ? i + 1 : dy < 0 ? -i : 0), i % 3 === 0 ? col2 : col);
  }
  for (const r of [2.6, 4.9, 7.2]) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * TAU;
      const sag = 1 - 0.18 * Math.abs(Math.sin(t * 4));
      c.set(Math.round(7.5 + Math.cos(t) * r * sag), Math.round(7.5 + Math.sin(t) * r * sag), col);
    }
  }
  return c;
});

// ---- crops ----
function stalks(c, rand, { xs, h, cols, head = null, headCols = null, bend = 0.8 }) {
  for (const x0 of xs) {
    const hh = Math.max(1, h + ri(rand, 3) - 1);
    const lean = (rand() - 0.5) * bend;
    for (let k = 0; k < hh; k++) {
      const y = 15 - k;
      const x = Math.round(x0 + lean * (k / Math.max(1, hh)));
      const isHead = head && k >= hh - head;
      const pal = isHead ? headCols : cols;
      c.set(x, y, pal[isHead ? (k + x0) % pal.length : (k === hh - 1 ? 2 : k % 3 === 0 ? 0 : 1)]);
      if (!isHead && k > 1 && rand() < 0.15) c.set(x + (rand() < 0.5 ? -1 : 1), y, cols[1]);
    }
  }
}
const WHEAT_GREEN = [0x0e7a13, 0x2aa31d, 0x4cc12e];
for (let s = 0; s < 8; s++) {
  def(`wheat_stage${s}`, ({ rand }) => {
    const c = canvas();
    const h = [2, 4, 6, 8, 10, 12, 13, 14][s];
    const ripe = s === 7;
    const cols = ripe ? [0x8f6d24, 0xb28b35, 0xcaa446] : s >= 5 ? [0x4f8a1c, 0x77a82c, 0x9cc63a] : WHEAT_GREEN;
    stalks(c, rand, {
      xs: [1, 3, 4, 6, 8, 9, 11, 13, 14], h, cols,
      head: s >= 5 ? (ripe ? 5 : 3) : null,
      headCols: ripe ? [0xdcbb65, 0xb3913a, 0xe8cf7c, 0x8f6d24] : [0x8cbf3a, 0x6f9f2a, 0xa7d24e],
    });
    return c;
  });
}
function leafyCrop(rand, stage, { leaf, root, blobs }) {
  const c = canvas();
  const h = [3, 5, 8, 11][stage];
  const baseY = stage === 3 ? 13 : 15;
  for (const x0 of [3, 8, 12]) {
    const nLeaves = 3 + stage;
    for (let i = 0; i < nLeaves; i++) {
      const ang = -0.75 + 1.5 * (i + 0.5) / nLeaves + (rand() - 0.5) * 0.25;
      const len = Math.max(2, Math.round(h * (0.65 + rand() * 0.35)));
      let x = x0 + 0.5, y = baseY + 0.5;
      for (let k = 0; k < len; k++) {
        const t = k / len;
        const px = Math.floor(x), py = Math.floor(y);
        c.set(px, py, leaf[k === 0 ? 0 : t < 0.4 ? 1 : t < 0.8 ? 2 : 3]);
        if (blobs && k === len - 1 && stage > 0) { c.set(px + 1, py, leaf[2]); c.set(px, py - 1, leaf[3]); c.set(px + 1, py - 1, leaf[2]); }
        else if (!blobs && stage >= 2 && k > len * 0.45 && k % 2 === 1) c.set(px + (ang >= 0 ? 1 : -1), py, leaf[3]);
        const a = ang * (0.5 + t);
        x += Math.sin(a); y -= Math.cos(a) * 0.95;
      }
    }
    if (stage === 3) {
      for (const [dx, dy, i] of [[0, 14, 0], [1, 14, 1], [0, 15, 1], [1, 15, 2]]) c.set(x0 + dx, dy, root[i]);
    }
  }
  return c;
}
for (let s = 0; s < 4; s++) {
  def(`carrots_stage${s}`, ({ rand }) => leafyCrop(rand, s, { leaf: [0x1f6a12, 0x2f8a1c, 0x4fae2c, 0x7cd04a], root: [0xff9a2e, 0xe8761a, 0xba5a0f] }));
  def(`potatoes_stage${s}`, ({ rand }) => leafyCrop(rand, s, { leaf: [0x1b5e19, 0x2c7a24, 0x44982f, 0x68b848], root: [0xd8b35e, 0xb8913f, 0x8f6d2a], blobs: true }));
}
function berryBush(rand, stage) {
  const c = canvas();
  const leaves = [0x1b4520, 0x255c29, 0x327333, 0x46903f];
  const nz = vnoise(rand, 16), blob = vnoise(rand, 8);
  const sz = [[3, 3.2, 12.5], [5, 5, 11], [7, 7, 9], [7.2, 7.2, 8.8]][stage];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5 - 8) / sz[0], dy = (y + 0.5 - sz[2]) / sz[1];
    if (y + 0.5 > 16) continue;
    const e = dx * dx + dy * dy + (blob(x, y) - 0.5) * 0.8;
    if (e > 1 || nz(x, y) < 0.18) continue;
    c.set(x, y, leaves[Math.max(0, Math.min(3, Math.floor((0.55 - (dx + dy) * 0.3 + (nz(x, y) - 0.5) * 0.6) * 4)))]);
  }
  if (stage >= 2) {
    const berry = stage === 3 ? [0xf04257, 0xc80f33, 0x7e0a20] : [0xb9d66f, 0x88b04a, 0x5a7f2a];
    const spots = scatter(rand, stage === 3 ? 7 : 5, 3.2);
    for (const p of spots) {
      const x = Math.floor(p.x), y = Math.floor(3 + (p.y / 16) * 11);
      if (alphaAt(c, x, y) === 0) continue;
      c.set(x, y, berry[0]); c.set(x + 1, y, berry[1]); c.set(x, y + 1, berry[1]); c.set(x + 1, y + 1, berry[2]);
    }
  }
  return c;
}
for (let s = 0; s < 4; s++) def(`sweet_berry_bush_stage${s}`, ({ rand }) => berryBush(rand, s));

// ===========================================================================
// UTILITY / DECORATIVE BLOCKS
// ===========================================================================
def('torch', () => {
  const c = canvas();
  c.set(7, 6, 0xfffbd0); c.set(8, 6, 0xffd24a);
  c.set(7, 7, 0xffc02e); c.set(8, 7, 0xe8861a);
  for (let y = 8; y < N; y++) { c.set(7, y, y % 3 === 0 ? 0x97763f : 0x8a6a37); c.set(8, y, y % 4 === 1 ? 0x5a4121 : 0x654a27); }
  return c;
});
def('ladder', () => {
  const c = canvas();
  const L = [0xa3824d, 0x8a6a3c, 0x6b5130, 0x4f3b22];
  for (let y = 0; y < N; y++) { c.set(1, y, y % 5 === 2 ? L[1] : L[0]); c.set(2, y, L[2]); c.set(13, y, y % 5 === 4 ? L[1] : L[0]); c.set(14, y, L[2]); }
  for (let r = 0; r < 4; r++) {
    const y = r * 4 + 1;
    for (let x = 3; x <= 12; x++) { c.set(x, y, x % 4 === 1 ? L[1] : L[0]); c.set(x, y + 1, L[3]); }
  }
  return c;
});
def('chest_top', () => chestTex('top'));
def('chest_side', () => chestTex('side'));
def('chest_front', () => chestTex('front'));
function chestTex(kind) {
  const P = [0x5e3a14, 0x7f5220, 0x94612a, 0xa56e33, 0xb57c3b, 0xc3894a];
  const c = planksTex(seeded('chest_planks_' + kind), P);
  const outline = 0x2a1a08;
  for (let i = 0; i < N; i++) { c.set(i, 0, outline); c.set(i, 15, outline); c.set(0, i, outline); c.set(15, i, outline); }
  if (kind !== 'top') {
    for (let x = 0; x < N; x++) { c.set(x, 5, outline); c.set(x, 6, 0x6d4519); }
    for (let x = 1; x < 15; x++) c.set(x, 4, 0x7a4f22);
  }
  if (kind === 'front') {
    c.pattern(6, 4, [
      'kkkk',
      'kLlk',
      'klDk',
      'kkkk',
    ], { k: 0x1e1e1e, L: 0xe6e6e6, l: 0xb3b3b3, D: 0x7b7b7b });
  }
  return c;
}
def('crafting_table_top', ({ get }) => {
  const c = get('oak_planks')[0].clone();
  const dark = 0x4e3a20, frame = 0x6d5230, light = 0xc4a36c;
  for (let i = 0; i < N; i++) { c.set(i, 0, frame); c.set(0, i, frame); c.set(i, 15, dark); c.set(15, i, dark); }
  for (let i = 1; i < 15; i++) { c.set(i, 1, light); c.set(1, i, light); }
  for (const g of [5, 10]) for (let i = 2; i < 14; i++) { c.set(g, i, dark); c.set(i, g, dark); c.set(g + 1, i, 0x8f7245); c.set(i, g + 1, 0x8f7245); }
  for (const g of [5, 10]) for (const h of [5, 10]) c.set(g, h, 0x3a2a15);
  return c;
});
function craftingSide(front) {
  const c = planksTex(seeded('crafting_side_planks'), [0x4a3519, 0x6b4f2a, 0x7a5b31, 0x866638, 0x927040, 0x9c7a47]);
  for (let x = 0; x < N; x++) { c.set(x, 0, 0xc19f69); c.set(x, 1, 0xa88a58); c.set(x, 2, 0x8f7547); c.set(x, 3, 0x3b2b16); }
  for (let y = 3; y < N; y++) { c.set(0, y, 0x5a4225); c.set(15, y, 0x3b2b16); }
  if (front) {
    // saw
    c.pattern(2, 4, [
      'hhh.....',
      'h.h.....',
      'hhhh....',
      '.gGG....',
      '.gGG....',
      '.gGG....',
      '.gGGt...',
      '.gGG....',
      '.gGGt...',
      '..gG....',
    ], { h: 0x5b3a1a, g: 0xd8d8d8, G: 0xa0a0a0, t: 0x6e6e6e });
    // hammer
    c.pattern(9, 5, [
      'mMMMMm',
      'mMMMMm',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
    ], { m: 0x6a6a6a, M: 0x9c9c9c, h: 0x8a5a2b, H: 0x5e3c1b });
  } else {
    // pickaxe & shears
    c.pattern(2, 5, [
      '.MMMMM.',
      'M..h..M',
      '...h...',
      '...h...',
      '...h...',
      '...h...',
      '...H...',
    ], { M: 0x9c9c9c, h: 0x8a5a2b, H: 0x5e3c1b });
    c.pattern(10, 5, [
      'g..g',
      'g..g',
      '.gg.',
      '.gg.',
      'r..r',
      'rr.rr',
    ], { g: 0xc8c8c8, r: 0xa82a1e });
  }
  return c;
}
def('crafting_table_front', () => craftingSide(true));
def('crafting_table_side', () => craftingSide(false));

def('furnace_top', ({ rand }) => {
  const c = noiseTex(rand, FINE, [0x6f6f6f, 0x787878, 0x818181, 0x8a8a8a], [15, 35, 35, 15]);
  for (let i = 0; i < N; i++) { c.set(i, 0, 0x979797); c.set(0, i, 0x979797); c.set(i, 15, 0x5a5a5a); c.set(15, i, 0x5a5a5a); }
  for (let i = 2; i < 14; i++) { c.set(i, 2, 0x5f5f5f); c.set(2, i, 0x5f5f5f); c.set(i, 13, 0x959595); c.set(13, i, 0x959595); }
  return c;
});
def('furnace_side', ({ rand, get }) => {
  const c = get('stone')[0].clone();
  const top = noiseTex(rand, FINE, [0x818181, 0x8a8a8a, 0x939393], [30, 40, 30]);
  for (let y = 0; y < 3; y++) for (let x = 0; x < N; x++) c.set(x, y, top.get(x, y));
  for (let x = 0; x < N; x++) { c.set(x, 0, 0x9d9d9d); c.set(x, 3, 0x4f4f4f); c.set(x, 15, 0x5a5a5a); }
  for (let y = 3; y < N; y++) { c.set(0, y, 0x8e8e8e); c.set(15, y, 0x5a5a5a); }
  return c;
});
function furnaceFront(lit) {
  return ({ get }) => {
    const c = get('furnace_side')[0].clone();
    // vent slot
    for (let x = 4; x < 12; x++) { c.set(x, 5, 0x2a2a2a); c.set(x, 4, 0x5e5e5e); c.set(x, 6, 0x9a9a9a); }
    // opening frame
    for (let x = 3; x < 13; x++) { c.set(x, 8, 0x9f9f9f); c.set(x, 14, 0x5a5a5a); }
    for (let y = 8; y < 15; y++) { c.set(3, y, 0x929292); c.set(12, y, 0x5e5e5e); }
    for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) {
      if (!lit) c.set(x, y, y === 9 ? 0x121212 : (x + y) % 5 === 0 ? 0x262626 : 0x1c1c1c);
      else {
        const h = 13 - y;
        const flick = [1, 3, 2, 4, 2, 3, 1, 2][x - 4];
        let col = 0x2a1a0a;
        if (h <= flick) col = h === 0 ? 0xfff2a0 : h === flick ? 0xd8521a : h === 1 ? 0xffc93a : 0xf58a1e;
        c.set(x, y, col);
      }
    }
    if (lit) for (let x = 4; x < 12; x++) c.set(x, 14, 0x8a5a2a);
    return c;
  };
}
def('furnace_front', furnaceFront(false));
def('furnace_front_on', furnaceFront(true));

def('bookshelf', ({ rand, get }) => {
  const c = get('oak_planks')[0].clone();
  const books = [
    [0x9a2a2a, 0x6e1a1a], [0x2d4f97, 0x1d3368], [0x2f6e2f, 0x1e4a1e], [0x8a6a3a, 0x5e4424], [0xc9aa60, 0x927a3f],
    [0x6a3582, 0x472158], [0xb86430, 0x81431e], [0x3a7f7f, 0x255656], [0xd7d0c0, 0x9c9585],
  ];
  const back = 0x2d2012;
  for (const [y0, y1] of [[1, 6], [9, 14]]) {
    for (let x = 0; x < N; x++) for (let y = y0; y <= y1; y++) c.set(x, y, back);
    let x = 0;
    while (x < N) {
      const w = rand() < 0.35 ? 2 : 1;
      const top = y0 + (rand() < 0.35 ? 1 : 0);
      const [light, dark] = pick(rand, books);
      const band = top + 1 + ri(rand, 3);
      for (let i = 0; i < w && x + i < N; i++) for (let y = top; y <= y1; y++) {
        let col = i === 0 ? light : dark;
        if (w === 1) col = light;
        if (y === band) col = lighten(col, 0.35);
        if (y === y1) col = shade(col, 0.75);
        c.set(x + i, y, col);
      }
      x += w;
      if (rand() < 0.12 && x < N) x += 1; // gap
    }
  }
  for (let x = 0; x < N; x++) { c.set(x, 0, c.get(x, 0)); c.set(x, 7, shade(c.get(x, 7), 1.05)); c.set(x, 8, shade(c.get(x, 8), 0.82)); }
  return c;
});

def('tnt_side', () => {
  const c = canvas();
  const stick = [0x8f1d0e, 0xdb4a2e, 0xc53a22, 0xae2e1a];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let col = stick[x % 4];
    if (y === 0 || y === 15) col = shade(col, 0.78);
    if ((y === 2 || y === 13) && x % 4 !== 0) col = shade(col, 0.88);
    c.set(x, y, col);
  }
  for (let x = 0; x < N; x++) {
    c.set(x, 4, 0xc9c9c9); c.set(x, 11, 0xa9a9a9);
    for (let y = 5; y < 11; y++) c.set(x, y, 0xe6e6e6);
    c.set(x, 10, 0xd2d2d2);
  }
  c.pattern(2, 6, [
    'TTT.N..N.TTT',
    '.T..NN.N..T.',
    '.T..N.NN..T.',
    '.T..N..N..T.',
  ], { T: 0x2b2b2b, N: 0x2b2b2b });
  return c;
});
function tntEnds(fuse) {
  const c = canvas();
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    c.pattern(sx * 4, sy * 4, [
      'gmmg',
      'mLlm',
      'mlkd',
      'gddg',
    ], { g: 0x7a170b, d: 0x9e2412, m: 0xc2331c, L: 0xef7352, l: 0xd8472c, k: 0xb02a16 });
  }
  if (fuse) {
    c.pattern(6, 6, [
      '.ss.',
      'sGgs',
      'sgDs',
      '.ss.',
    ], { s: 0x2e2e2e, G: 0xc4c4c4, g: 0x929292, D: 0x5e5e5e });
  }
  return c;
}
def('tnt_top', () => tntEnds(true));
def('tnt_bottom', () => tntEnds(false));

// ---- pumpkin & melon ----
const PUMPKIN = [0xa65a0c, 0xc46f12, 0xd98319, 0xe59522, 0xf0a834];
def('pumpkin_side', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = x % 4;
    let i = [0, 3, 4, 2][r];
    if (r !== 0 && nz(x, y) < 0.2) i -= 1;
    if (r === 2 && nz(x, y) > 0.8) i = 4;
    if (y === 0 || y === 15) i = Math.max(0, i - 1);
    c.set(x, y, PUMPKIN[Math.max(0, i)]);
  }
  return c;
});
def('pumpkin_top', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const ang = Math.atan2(dy, dx);
    const s = Math.cos(ang * 4 + 0.4);
    let i = s > 0.8 ? 1 : s > 0.2 ? 3 : s > -0.5 ? 4 : 2;
    if (nz(x, y) > 0.82) i = Math.min(4, i + 1); else if (nz(x, y) < 0.15) i = Math.max(1, i - 1);
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d > 6.9) i = Math.max(0, i - 1);
    if (d < 3) i = Math.max(1, i - 1);
    c.set(x, y, PUMPKIN[i]);
  }
  c.pattern(6, 6, [
    '.ss.',
    'sSgs',
    'sggs',
    '.ss.',
  ], { s: 0x4f4117, S: 0x8a7a2e, g: 0x6e5e22 });
  return c;
});
const FACE = [
  '................',
  '................',
  '................',
  '...X.......X....',
  '..XXX.....XXX...',
  '.XXXXX...XXXXX..',
  '................',
  '................',
  '..X.........X...',
  '..XXXXXXXXXXX...',
  '...XX.XXX.XX....',
  '....X..X..X.....',
  '................',
  '................',
  '................',
  '................',
].map((r) => ' ' + r.slice(0, 15));
def('carved_pumpkin', ({ get }) => {
  const c = get('pumpkin_side')[0].clone();
  c.pattern(0, 0, FACE, { X: 0x3a1f04 });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (FACE[y][x] === 'X' && FACE[y - 1]?.[x] !== 'X') c.set(x, y, 0x241302);
  return c;
});
def('jack_o_lantern', ({ get }) => {
  const c = get('pumpkin_side')[0].clone();
  c.pattern(0, 0, FACE, { X: 0xffd84a });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (FACE[y][x] !== 'X') continue;
    const top = FACE[y - 1]?.[x] !== 'X';
    const inner = !top && FACE[y][x - 1] === 'X' && FACE[y][x + 1] === 'X';
    c.set(x, y, top ? 0xe79a1c : inner ? 0xfff6b0 : 0xffdd4a);
  }
  return c;
});
const MELON = [0x3f6b12, 0x55851a, 0x6e9e22, 0x8ab62e, 0xa5c93e];
def('melon_side', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16), wob = vnoise(rand, 2, 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xs = x + (wob(x, y) - 0.5) * 2;
    const r = ((Math.round(xs) % 5) + 5) % 5;
    let i = [3, 4, 3, 1, 0][r];
    if (nz(x, y) > 0.8) i = Math.min(4, i + 1); else if (nz(x, y) < 0.15) i = Math.max(0, i - 1);
    c.set(x, y, MELON[i]);
  }
  return c;
});
def('melon_top', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ang = Math.atan2(y - 7.5, x - 7.5);
    const s = Math.sin(ang * 5);
    let i = s > 0.55 ? 4 : s > 0 ? 3 : s > -0.6 ? 1 : 0;
    if (nz(x, y) > 0.82) i = Math.min(4, i + 1);
    c.set(x, y, MELON[i]);
  }
  c.pattern(6, 6, ['.bb.', 'bBbb', 'bbbd', '.bd.'], { b: 0x5d6e1a, B: 0x8a9a2e, d: 0x3f4a10 });
  return c;
});

// ---- hay ----
const HAY = [0x8e6d15, 0xa9851d, 0xbe9a24, 0xcfae30, 0xdcc047, 0xe8d263];
def('hay_block_side', ({ rand }) => {
  const c = noiseTex(rand, [[16, 2, 0.5], [16, 16, 0.5]], HAY, [8, 16, 26, 26, 16, 8]);
  for (const y0 of [2, 12]) for (let x = 0; x < N; x++) {
    c.set(x, y0, x % 3 === 0 ? 0x8a3c1a : 0x7a3216);
    c.set(x, y0 + 1, x % 3 === 1 ? 0x5e2610 : 0x6a2b12);
  }
  return c;
});
def('hay_block_top', ({ rand }) => {
  const c = noiseTex(rand, [[8, 8, 0.4], [16, 16, 0.6]], HAY, [10, 16, 24, 26, 16, 8]);
  for (let k = 0; k < 20; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    c.set(x, y, HAY[5]); c.set(x + 1, y + 1, HAY[0]);
  }
  for (let i = 0; i < N; i++) { c.set(i, 0, HAY[1]); c.set(i, 15, HAY[0]); c.set(0, i, HAY[1]); c.set(15, i, HAY[0]); }
  return c;
});

// ---- cactus ----
const CACTUS = [0x0b4a14, 0x0f6019, 0x157a22, 0x21902e, 0x4ea94a, 0x86c974];
def('cactus_side', () => {
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 1; x < 15; x++) {
    const r = (x - 1) % 4;
    let i = [1, 3, 4, 2][r];
    if (x === 1) i = 0;
    if (x === 14) i = 1;
    c.set(x, y, CACTUS[i]);
  }
  // spines
  const spines = [[0, 2], [0, 9], [15, 5], [15, 13], [4, 1], [8, 6], [12, 10], [4, 12], [8, 14], [12, 3]];
  for (const [x, y] of spines) {
    c.set(x, y, 0x1c2a10);
    if (x > 0 && x < 15) c.set(x, y - 1, 0xd6d6a6);
    else c.set(x, y, 0xd6d6a6);
  }
  return c;
});
function cactusEnd(top) {
  const c = canvas();
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let i = d > 6 ? 1 : d > 4.5 ? 3 : d > 2.5 ? 2 : 4;
    if (!top) i = d > 6 ? 1 : d > 5 ? 3 : (d > 1.5 && d < 2.6) ? 1 : 2;
    c.set(x, y, CACTUS[i]);
  }
  if (top) {
    for (const [x, y] of [[7, 7], [8, 8], [4, 4], [11, 11], [4, 11], [11, 4]]) c.set(x, y, CACTUS[5]);
    for (const [x, y] of [[8, 7], [7, 8]]) c.set(x, y, CACTUS[3]);
  }
  return c;
}
def('cactus_top', () => cactusEnd(true));
def('cactus_bottom', () => cactusEnd(false));

// ---- doors, trapdoor ----
const OAKW = { d: 0x5e4526, D: 0x4a361d, m: 0x8a6a3c, p: 0x9c7a47, P: 0xae8b55, L: 0xbf9c63, k: 0x3a3a3a, K: 0x777777 };
def('oak_door_top', () => sprite([
  'DDDDDDDDDDDDDDDD',
  'DLLLLLLLLLLLLLLd',
  'DLd....dd....mLd',
  'DLd....dd....mLd',
  'DLd....dd....mLd',
  'DLd....dd....mLd',
  'DLmmmmmmmmmmmmLd',
  'DLLLLLLLLLLLLLLd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
], OAKW));
def('oak_door_bottom', () => sprite([
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPpmPpd',
  'DpPpmpPpmpPkKPpd',
  'DpPpmpPpmpPkkPpd',
  'DpPpmpPpmpPpmPpd',
  'DLLLLLLLLLLLLLLd',
  'DLppppppppppppmd',
  'DLpPPPPPPPPPPmmd',
  'DLpPmmmmmmmmPmmd',
  'DLpPmpppppppPmmd',
  'DLpPmpppppppPmmd',
  'DLpPPPPPPPPPPmmd',
  'DLpmmmmmmmmmmmmd',
  'DLmmmmmmmmmmmmmd',
  'DLLLLLLLLLLLLLLd',
  'DDDDDDDDDDDDDDDD',
], OAKW));
def('oak_trapdoor', () => sprite([
  'DDDDDDDDDDDDDDDD',
  'DLLLLLLLLLLLLLLd',
  'DLppmppmppmppmmd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLmmmmmmmmmmmmmd',
  'DLLLLLLLLLLLLLLd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLp....mm....mmd',
  'DLmmmmmmmmmmmmmd',
  'DLddddddddddddmd',
  'DDDDDDDDDDDDDDDD',
], OAKW));
def('spawner', () => {
  const c = canvas();
  const bar = 0x253342, hi = 0x3f5670, lo = 0x151d26;
  const isBar = (v) => v === 0 || v === 5 || v === 10 || v === 15;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isBar(x) && !isBar(y)) continue;
    let col = bar;
    if (isBar(x) && isBar(y)) col = hi;
    else if ((isBar(y) && x % 5 === 1) || (isBar(x) && y % 5 === 1)) col = hi;
    else if ((isBar(y) && x % 5 === 4) || (isBar(x) && y % 5 === 4)) col = lo;
    c.set(x, y, col);
  }
  return c;
});

// ---- bed ----
const BED = { red: [0x7a1a16, 0x8e201b, 0xa12722, 0xb3322c, 0xc4433b], white: [0xb5b5b5, 0xcfcfcf, 0xe2e2e2, 0xf2f2f2], wood: [0x4f3b22, 0x6b5130, 0x86683d, 0x9c7b49, 0xb08f59] };
function blanket(rand, c, y0, y1) {
  const nz = vnoise(rand, 16);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < N; x++) {
    const t = nz(x, y);
    c.set(x, y, BED.red[t < 0.25 ? 1 : t > 0.8 ? 3 : 2]);
  }
}
def('bed_head_top', ({ rand }) => {
  const c = canvas();
  blanket(rand, c, 0, 15);
  for (let y = 0; y < 7; y++) for (let x = 0; x < N; x++) c.set(x, y, BED.white[2]);
  for (let y = 1; y < 6; y++) for (let x = 2; x < 14; x++) {
    let col = BED.white[3];
    if (y === 5 || x === 13) col = BED.white[1];
    if (y === 1 || x === 2) col = 0xffffff;
    c.set(x, y, col);
  }
  for (let x = 0; x < N; x++) { c.set(x, 7, BED.red[4]); c.set(x, 8, BED.red[3]); }
  for (let y = 0; y < N; y++) { c.set(0, y, shade(c.get(0, y), 0.85)); c.set(15, y, shade(c.get(15, y), 0.85)); }
  return c;
});
def('bed_foot_top', ({ rand }) => {
  const c = canvas();
  blanket(rand, c, 0, 15);
  for (let x = 0; x < N; x++) { c.set(x, 14, BED.red[1]); c.set(x, 15, BED.red[0]); }
  for (let y = 0; y < N; y++) { c.set(0, y, BED.red[1]); c.set(15, y, BED.red[1]); }
  for (const [x, y] of [[4, 4], [11, 7], [6, 10], [9, 2]]) { c.set(x, y, BED.red[4]); c.set(x + 1, y, BED.red[3]); }
  return c;
});
function bedSide(rand, end) {
  const c = canvas();
  blanket(rand, c, 0, 9);
  for (let x = 0; x < N; x++) {
    c.set(x, 7, BED.red[4]); c.set(x, 8, BED.red[2]); c.set(x, 9, BED.red[1]);
    if (end && (x === 0 || x === 15)) { c.set(x, 7, BED.red[2]); c.set(x, 8, BED.red[1]); c.set(x, 9, BED.red[0]); }
    for (let y = 10; y < N; y++) {
      let col = y === 10 ? BED.wood[4] : y === 12 ? BED.wood[2] : BED.wood[3];
      const leg = x < 3 || x > 12;
      if (y >= 13) col = leg ? (x === 0 || x === 13 ? BED.wood[3] : BED.wood[2]) : BED.wood[0];
      if (y === 15 && leg) col = BED.wood[1];
      c.set(x, y, col);
    }
  }
  return c;
}
def('bed_head_side', ({ rand }) => bedSide(rand, false));
def('bed_foot_side', ({ rand }) => bedSide(rand, false));
def('bed_head_end', ({ rand }) => bedSide(rand, true));
def('bed_foot_end', ({ rand }) => bedSide(rand, true));

// ===========================================================================
// ANIMATED: water, lava, fire
// ===========================================================================
function liquidFrames(rand, { frames, pal, flow = 0, warpAmp = 1.6, nMain = 7, kxr = [-3, 3], kyr = [-3, 3], turb = 0 }) {
  const main = mkWaves(rand, nMain, { kx: kxr, ky: kyr, kt: [1, -1, 2, -2] });
  const w1 = mkWaves(rand, 3, { kx: [-2, 2], ky: [-2, 2], kt: [1, -1] });
  const w2 = mkWaves(rand, 3, { kx: [-2, 2], ky: [-2, 2], kt: [1, -1] });
  const out = [];
  for (let t = 0; t < frames; t++) {
    const tt = t / frames;
    const shift = flow * N * tt; // flow: tiles per loop
    const f = equalize(field((x, y) => {
      const ys = y - shift;
      const wx = waves(w1, x, ys, tt) * warpAmp, wy = waves(w2, x, ys, tt) * warpAmp;
      let v = waves(main, x + wx, ys + wy, tt);
      if (turb) v = v * (1 - turb) + (1 - Math.abs(waves(w1, x * 1, ys, tt) * 2)) * turb;
      return v;
    }));
    out.push(paint(canvas(), f, pal));
  }
  return out;
}
const WATER_PAL = palette([gray(158, 180), gray(170, 182), gray(180, 184), gray(190, 187), gray(202, 191), gray(220, 196)], [8, 20, 30, 24, 12, 6]);
def('water_still', ({ rand }) => liquidFrames(rand, { frames: 32, pal: WATER_PAL }));
def('water_flow', ({ rand }) => liquidFrames(rand, { frames: 32, pal: WATER_PAL, flow: 1, kxr: [-3, 3], kyr: [1, 2], warpAmp: 1.2 }));
const LAVA_PAL = palette([0x9c2c06, 0xbd400b, 0xd2560f, 0xe26d15, 0xed8a1f, 0xf5ac2f, 0xfbd35a], [6, 14, 22, 22, 17, 12, 7]);
def('lava_still', ({ rand }) => liquidFrames(rand, { frames: 20, pal: LAVA_PAL, warpAmp: 2.0, turb: 0.3, kxr: [-2, 2], kyr: [-2, 2] }));
def('lava_flow', ({ rand }) => liquidFrames(rand, { frames: 16, pal: LAVA_PAL, flow: 1, kyr: [1, 2], warpAmp: 1.8, turb: 0.3 }));

const FIRE_COLS = [0xfff8d0, 0xffe45a, 0xffbf2a, 0xfb961f, 0xea6e1a, 0xcc4a18];
function fireFrames(rand, cols = FIRE_COLS) {
  const F = 16;
  const rise = [];
  while (rise.length < 7) {
    const kx = ri(rand, 7) - 3, ky = 1 + ri(rand, 2);
    rise.push({ kx, ky, ph: rand() * TAU, a: 1 / Math.hypot(kx, ky) });
  }
  const tong = [2, 3, 5].map((k) => ({ k, m: pick(rand, [1, -1, 2]), ph: rand() * TAU, a: 1 / k }));
  const out = [];
  for (let t = 0; t < F; t++) {
    const c = canvas();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let T = 0, nt = 0;
      for (const w of rise) { T += w.a * Math.sin(TAU * (w.kx * x / N + w.ky * (y + t) / N) + w.ph); nt += w.a; }
      T /= nt;
      let S = 0, ns = 0;
      for (const w of tong) { S += w.a * Math.sin(TAU * (w.k * x / N + w.m * t / F) + w.ph); ns += w.a; }
      S /= ns;
      const h = (15 - y) / 15; // 0 bottom .. 1 top
      const edge = Math.abs(x - 7.5) / 7.5;
      const I = 1.48 - h * 1.42 + T * 0.4 + S * 0.36 - edge * edge * 0.22;
      if (I < 0.34) continue;
      const col = I > 1.4 ? cols[0] : I > 1.18 ? cols[1] : I > 0.95 ? cols[2] : I > 0.72 ? cols[3] : I > 0.5 ? cols[4] : cols[5];
      c.set(x, y, col);
    }
    out.push(c);
  }
  return out;
}
def('fire_0', ({ rand }) => fireFrames(rand));
def('fire_1', ({ rand }) => fireFrames(rand));

// ---- stripped logs ----
function strippedSide(rand, P) {
  const c = noiseTex(rand, [[16, 2, 0.4], [16, 8, 0.2], [16, 16, 0.4]], P.slice(1), [10, 24, 34, 22, 10]);
  for (let k = 0; k < 5; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 2 + ri(rand, 4);
    for (let i = 0; i < len; i++) setW(c, x, y + i, P[0]);
  }
  return c;
}
for (const [w, W] of Object.entries(WOOD)) {
  def(`stripped_${w}_log`, ({ rand }) => strippedSide(rand, W.stripped));
  def(`stripped_${w}_log_top`, ({ rand, get }) => {
    const rim = get(`stripped_${w}_log`)[0].clone().map((x, y, p) => shade(p, 0.84));
    return logTopTex(rand, rim, W.ring);
  });
}

// ===========================================================================
// NETHER
// ===========================================================================
const NRACK = [0x481515, 0x571c1c, 0x652424, 0x712d2d, 0x7d3737, 0x8f4747];
def('netherrack', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.25], [8, 8, 0.3], [16, 16, 0.45]], NRACK, [8, 18, 28, 24, 15, 7]);
  for (let k = 0; k < 9; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    setW(c, x, y, 0x381010); if (rand() < 0.6) setW(c, x + 1, y, 0x461313);
    setW(c, x, y - 1, 0x9c5454);
  }
  return c;
});
function smallBricks(rand, { face, top, left, low, mortar }) {
  const c = canvas();
  const nz = equalize(field(fbm(rand, FINE)));
  const pal = palette(face, [30, 45, 25]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const course = y >> 2, yy = y & 3;
    const bx = wrap(x - (course % 2 ? 4 : 0));
    if (yy === 3 || bx === 7 || bx === 15) { c.set(x, y, mortar); continue; }
    let col = pal(nz[y * N + x]);
    if (yy === 0) col = top;
    else if (bx === 0 || bx === 8) col = left;
    if (yy === 2 && (bx === 6 || bx === 14 || rand() < 0.35)) col = low;
    c.set(x, y, col);
  }
  return c;
}
def('nether_bricks', ({ rand }) => smallBricks(rand, { face: [0x2d1317, 0x35171c, 0x3d1b21], top: 0x52282f, left: 0x482329, low: 0x250f13, mortar: 0x140709 }));
def('red_nether_bricks', ({ rand }) => smallBricks(rand, { face: [0x4b0709, 0x590a0d, 0x660d10], top: 0x7c171b, left: 0x701317, low: 0x3c0507, mortar: 0x240203 }));

const SOUL_SAND = [0x3b2a20, 0x46332a, 0x513d31, 0x5c473a, 0x685244, 0x7a6352];
const SOUL_FACE = ['kk.kk', 'kk.kk', '.....', '.kkk.', '.k.k.', '.kkk.'];
def('soul_sand', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.3], [8, 8, 0.3], [16, 16, 0.4]], SOUL_SAND.slice(1), [12, 30, 30, 18, 10]);
  // faint screaming faces pressed into the sand
  for (const [fx, fy] of [[1 + ri(rand, 3), 1 + ri(rand, 2)], [9 + ri(rand, 2), 8 + ri(rand, 2)]]) {
    for (let y = -1; y <= 6; y++) for (let x = -1; x <= 5; x++) c.set(fx + x, fy + y, mix(c.get(fx + x, fy + y), SOUL_SAND[2], 0.35));
    SOUL_FACE.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'k') {
      c.set(fx + x, fy + y, SOUL_SAND[0]);
      const below = SOUL_FACE[y + 1];
      if (!below || below === '.....') c.set(fx + x, fy + y + 1, SOUL_SAND[4]);
    } });
  }
  return c;
});
def('soul_soil', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.25], [8, 8, 0.3], [16, 16, 0.45]], [0x2f231a, 0x3a2b20, 0x453327, 0x4f3c2e, 0x5a4535, 0x69523f], [8, 18, 28, 24, 15, 7]);
  for (let k = 0; k < 7; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, 0x7a624e); setW(c, x + 1, y + 1, 0x2a1f17); }
  return c;
});
def('nether_quartz_ore', ({ rand, get }) => oreTex(get('netherrack')[0], rand, {
  cols: [0xffffff, 0xeae5dc, 0xcfc7b9, 0x9f9383], count: 7, shapes: [1, 3, 5, 7, 9, 2], shadow: 0.66,
}));
def('nether_gold_ore', ({ rand, get }) => {
  const c = oreTex(get('netherrack')[0], rand, { cols: [0xfff6a8, 0xfcdb4b, 0xe8a824, 0x9e6a0e], count: 6, shapes: [1, 7, 9], shadow: 0.66 });
  for (let k = 0; k < 7; k++) {
    const x = 1 + ri(rand, 14), y = 1 + ri(rand, 14);
    const p = c.get(x, y);
    if (p[0] > 200 && p[1] > 150) continue;
    c.set(x, y, 0xf4c63a); c.set(x + 1, y + 1, shade(c.get(x + 1, y + 1), 0.7));
  }
  return c;
});
def('magma_block', ({ rand }) => {
  const pts = scatter(rand, 9, 4.2);
  for (const p of pts) p.w = 0.85 + rand() * 0.3;
  const v = voronoi(pts);
  const nz = vnoise(rand, 8);
  const f = equalize(field(fbm(rand, FINE)));
  const cell = palette([0x3a1206, 0x4a1a09, 0x5a220d, 0x6a2b12], [20, 35, 30, 15]);
  const frames = [];
  for (let t = 0; t < 3; t++) {
    const c = canvas();
    for (let k = 0; k < 256; k++) {
      const x = k & 15, y = k >> 4;
      const g = v.d2[k] - v.d1[k];
      const pulse = Math.sin(TAU * (t / 3 + nz(x, y) * 1.5));
      if (g < 0.75) c.set(x, y, pulse > 0.35 ? 0xffc451 : pulse > -0.45 ? 0xff9b2c : 0xef741c);
      else if (g < 1.35) c.set(x, y, pulse > 0 ? 0xcf4d16 : 0xae3a0e);
      else c.set(x, y, cell(f[k]));
    }
    frames.push(c);
  }
  return frames;
});

const BASALT = [0x2e2e32, 0x3a3a3f, 0x46464b, 0x525257, 0x5e5e63, 0x6d6d72];
def('basalt_side', ({ rand }) => {
  const c = noiseTex(rand, [[16, 2, 0.45], [16, 4, 0.2], [16, 16, 0.35]], BASALT, [8, 18, 28, 24, 15, 7]);
  for (let k = 0; k < 6; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 4 + ri(rand, 7);
    for (let i = 0; i < len; i++) { setW(c, x, y + i, BASALT[0]); if (rand() < 0.7) setW(c, x + 1, y + i, BASALT[5]); }
  }
  return c;
});
def('basalt_top', ({ rand }) => {
  const c = canvas();
  const wob = vnoise(rand, 4), nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.75 + Math.hypot(dx, dy) * 0.25 + (wob(x, y) - 0.5) * 1.2;
    const r = d / 2.4, fr = r - Math.floor(r);
    let i = fr < 0.25 ? 1 : fr < 0.6 ? 3 : 4;
    if (nz(x, y) > 0.85) i = Math.min(5, i + 1); else if (nz(x, y) < 0.12) i = Math.max(0, i - 1);
    if (x === 0 || y === 0) i = 5; else if (x === 15 || y === 15) i = 0;
    c.set(x, y, BASALT[i]);
  }
  return c;
});
const BLACKSTONE = [0x17121a, 0x1f1921, 0x272029, 0x2f2731, 0x39303b, 0x483e4b];
def('blackstone', ({ rand }) => {
  const c = noiseTex(rand, [[2, 2, 0.25], [4, 4, 0.3], [8, 8, 0.2], [16, 16, 0.25]], BLACKSTONE, [8, 18, 28, 24, 15, 7]);
  for (let k = 0; k < 8; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, 0x574b5a); setW(c, x + 1, y, BLACKSTONE[4]); }
  return c;
});
def('blackstone_top', ({ rand }) => swirlTop(rand, BLACKSTONE));

// ---- nylium, stems, planks, wart blocks ----
const CRIMSON_NY = [0x560a0a, 0x6d0e0e, 0x821414, 0x971b1b, 0xad2727, 0xc93e39];
const WARPED_NY = [0x0b4543, 0x105955, 0x156f69, 0x1b847b, 0x25998c, 0x3db7a4];
function nyliumTop(rand, P) {
  const c = noiseTex(rand, [[4, 4, 0.2], [8, 8, 0.3], [16, 16, 0.5]], P, [8, 16, 26, 26, 16, 8]);
  for (let k = 0; k < 10; k++) { const x = ri(rand, N), y = ri(rand, N); setW(c, x, y, lighten(P[5], 0.25)); setW(c, x + 1, y + 1, P[0]); }
  return c;
}
function nyliumSide(rand, get, top) {
  const c = get('netherrack')[0].clone();
  const t = get(top)[0];
  const d = fringeDepths(rand, 4, [0.45, 0.14, 0]);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < d[x]; y++) c.set(x, y, t.get(x, y));
    c.set(x, d[x] - 1, shade(t.get(x, d[x] - 1), 0.8));
    c.set(x, d[x], shade(c.get(x, d[x]), 0.8));
  }
  return c;
}
def('crimson_nylium', ({ rand }) => nyliumTop(rand, CRIMSON_NY));
def('warped_nylium', ({ rand }) => nyliumTop(rand, WARPED_NY));
def('crimson_nylium_side', ({ rand, get }) => nyliumSide(rand, get, 'crimson_nylium'));
def('warped_nylium_side', ({ rand, get }) => nyliumSide(rand, get, 'warped_nylium'));

const STEMS = {
  crimson: {
    bark: [0x2f0b16, 0x40101f, 0x4f1528, 0x5c1b30, 0x6b2239, 0x7d2b44], veins: [0xb8323e, 0xe0555a],
    ring: [0x5a1d33, 0x742a44, 0x843350, 0x943e5d],
    planks: [0x3c1a29, 0x5a2840, 0x662e49, 0x703451, 0x7c3b5a, 0x874263],
    wart: [0x520404, 0x680707, 0x7c0b0b, 0x901212, 0xa81d1d, 0xc23434],
  },
  warped: {
    bark: [0x161f24, 0x1e2a30, 0x26353a, 0x2e4045, 0x374c50, 0x42595c], veins: [0x17a595, 0x4ad8c2],
    ring: [0x185650, 0x206d66, 0x29827a, 0x33958b],
    planks: [0x123b39, 0x1d5652, 0x22625d, 0x287068, 0x2e7d74, 0x358a80],
    wart: [0x074040, 0x0b5555, 0x116a6a, 0x167e7e, 0x1f9594, 0x35b3ad],
  },
};
for (const [k, S] of Object.entries(STEMS)) {
  def(`${k}_stem`, ({ rand }) => {
    const c = barkTex(rand, S.bark, 4);
    for (let i = 0; i < 7; i++) {
      const x = ri(rand, N), y = ri(rand, N), len = 3 + ri(rand, 5);
      for (let j = 0; j < len; j++) setW(c, x, y + j, j === 0 || j === len - 1 ? S.veins[0] : S.veins[j % 3 === 1 ? 1 : 0]);
    }
    return c;
  });
  def(`${k}_stem_top`, ({ rand, get }) => logTopTex(rand, get(`${k}_stem`)[0], S.ring));
  def(`${k}_planks`, ({ rand }) => planksTex(rand, S.planks));
}
function wartBlock(rand, P) {
  const c = noiseTex(rand, [[4, 4, 0.3], [8, 8, 0.3], [16, 16, 0.4]], P.slice(0, 5), [10, 22, 32, 24, 12]);
  for (let k = 0; k < 14; k++) {
    const x = ri(rand, N), y = ri(rand, N);
    setW(c, x, y, P[5]); setW(c, x + 1, y, P[4]); setW(c, x, y + 1, P[3]); setW(c, x + 1, y + 1, P[1]);
  }
  return c;
}
def('nether_wart_block', ({ rand }) => wartBlock(rand, STEMS.crimson.wart));
def('warped_wart_block', ({ rand }) => wartBlock(rand, STEMS.warped.wart));
def('shroomlight', ({ rand }) => {
  const pts = scatter(rand, 12, 3.4);
  for (const p of pts) p.w = 0.8 + rand() * 0.4;
  const v = voronoi(pts);
  const pal = palette([0xa8401a, 0xc9581e, 0xe57a28, 0xf3993b, 0xfbb957, 0xffd683, 0xffedb8], [10, 14, 20, 22, 18, 11, 5]);
  const nz = vnoise(rand, 16);
  const c = canvas();
  for (let k = 0; k < 256; k++) {
    const edge = clamp01((v.d2[k] - v.d1[k]) / 2.6);
    c.set(k & 15, k >> 4, pal(clamp01(edge * 0.9 + (nz(k & 15, k >> 4) - 0.5) * 0.3)));
  }
  return c;
});

// ---- nether plants ----
function fungus(cap, dots, stem) {
  return () => sprite([
    '................',
    '................',
    '................',
    '......rrrr......',
    '....rrRRyRrr....',
    '...rRyRRRRyRr...',
    '...rRRRRyRRRr...',
    '..rrRyRRRRRyrr..',
    '..d.ddrsSrdd.d..',
    '..d....sS....d..',
    '.......sS.......',
    '.......sS.......',
    '......ssS.......',
    '.......sS.......',
    '......ssSS......',
    '.......sS.......',
  ], { r: cap[0], R: cap[1], d: cap[2], y: dots, s: stem[0], S: stem[1] });
}
def('crimson_fungus', fungus([0x8f1414, 0xc92b24, 0x640c10], 0xf2a33a, [0xd8b28f, 0xa8805f]));
def('warped_fungus', fungus([0x0f6b64, 0x1ca596, 0x0a4a46], 0xf28c28, [0xe7a870, 0xb57a45]));
function rootsTex(rand, P) {
  const c = canvas();
  const blades = [];
  for (let x = 1; x < 15; x++) {
    if (rand() < 0.3) continue;
    const center = 1 - Math.abs(x - 7.5) / 8;
    blades.push({ x, h: 4 + ri(rand, 5) + Math.round(center * 5), curl: rand() < 0.5 ? -1 : 1 });
  }
  blades.sort((a, b) => b.h - a.h);
  for (const b of blades) {
    for (let k = 0; k < b.h; k++) {
      const y = 15 - k;
      const x = b.x + (k >= b.h - 2 ? b.curl : 0) + (k === b.h - 1 ? b.curl : 0);
      c.set(x, y, P[Math.min(3, Math.floor((k / b.h) * 4))]);
    }
  }
  return c;
}
def('crimson_roots', ({ rand }) => rootsTex(rand, [0x5e0c10, 0x861818, 0xae2626, 0xd4453c]));
def('warped_roots', ({ rand }) => rootsTex(rand, [0x0b4e4a, 0x137068, 0x1c978a, 0x39c4b0]));
function netherWart(rand, stage) {
  const c = canvas();
  const W = [0x5c0909, 0x8a1414, 0xb42424, 0xde4a4a];
  const warts = [
    [[3, 13, 1], [7, 14, 1], [11, 13, 1]],
    [[2, 9, 2], [7, 7, 2], [11, 10, 2], [9, 13, 1], [4, 13, 1]],
    [[1, 4, 2], [6, 1, 3], [11, 4, 2], [8, 8, 2], [3, 9, 2], [12, 10, 2], [6, 12, 1]],
  ][stage];
  // stalks with small nodules
  for (const [x, y, s] of warts) {
    const sx = x + (s > 1 ? 1 : 0);
    for (let yy = y + s + 1; yy < N; yy++) {
      const xx = sx + ((yy >> 2) & 1);
      c.set(xx, yy, W[yy & 1 ? 0 : 1]);
      if (yy % 3 === 0 && rand() < 0.6) c.set(xx + (rand() < 0.5 ? -1 : 1), yy, W[1]);
    }
  }
  // bulbous lumpy warts
  for (const [x, y, s] of warts) {
    const n = s + 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
      if (n > 2 && (dx === 0 || dx === n - 1) && (dy === 0 || dy === n - 1)) continue;
      let i = 2;
      if (dx + dy === 0 || (n > 2 && dx + dy === 1)) i = 3;
      else if (dx === n - 1 || dy === n - 1) i = dx + dy >= 2 * n - 3 ? 0 : 1;
      c.set(x + dx, y + dy, W[i]);
    }
    if (n > 2) for (let k = 0; k < 2; k++) {
      const [bx, by] = pick(rand, [[-1, 1], [n, 1], [1, -1], [n - 1, n - 2], [-1, n - 2]]);
      c.set(x + bx, y + by, W[by < 1 ? 3 : 1]);
    }
  }
  return c;
}
for (let st = 0; st < 3; st++) def(`nether_wart_stage${st}`, ({ rand }) => netherWart(rand, st));

// ---- portal, crying obsidian, debris, quartz ----
const PORTAL_PAL = palette([
  [58, 10, 140, 215], [78, 16, 184, 200], [100, 28, 218, 188], [128, 48, 238, 180],
  [160, 84, 250, 182], [198, 138, 255, 196], [232, 198, 255, 212],
], [8, 16, 22, 22, 16, 10, 6]);
def('nether_portal', ({ rand }) => {
  // spinning vortices on a torus; the falloff reaches zero before the wrap seam, so it tiles
  const F = 32;
  const vort = scatter(rand, 4, 6).map((p, i) => ({ ...p, spin: i % 2 ? 1 : -1, arms: 2 + (i % 2), ph: rand() * TAU }));
  const bg = mkWaves(rand, 4, { kx: [-2, 2], ky: [-2, 2], kt: [1, -1] });
  const frames = [];
  for (let t = 0; t < F; t++) {
    const tt = t / F;
    const f = equalize(field((x, y) => {
      let v = 0, wsum = 0.15;
      for (const o of vort) {
        const dx = tdx(x + 0.5, o.x), dy = tdx(y + 0.5, o.y);
        const r = Math.hypot(dx, dy);
        const w = Math.max(0, 1 - r / 7.5) ** 2;
        if (!w) continue;
        v += w * Math.sin(o.arms * Math.atan2(dy, dx) + o.spin * (r * 1.1 - TAU * tt * 2) + o.ph);
        wsum += w;
      }
      return v / wsum * 0.8 + waves(bg, x, y, tt) * 0.35;
    }));
    frames.push(paint(canvas(), f, PORTAL_PAL));
  }
  return frames;
});
def('crying_obsidian', ({ rand, get }) => {
  const c = get('obsidian')[0].clone();
  const T = [0x4a129a, 0x7424d8, 0xa04cff, 0xd29aff];
  const spots = scatter(rand, 6, 4.5);
  for (const p of spots) {
    const x = Math.floor(p.x), y = Math.floor(p.y), len = 2 + ri(rand, 4);
    c.set(x - 1, y, T[1]); c.set(x, y, T[2]); c.set(x + 1, y, T[1]);
    for (let i = 1; i <= len; i++) setW(c, x, y + i, i === len ? T[3] : T[i === 1 ? 2 : 1]);
    setW(c, x + 1, y + 1, T[0]);
  }
  return c;
});
const DEBRIS = [0x2e1e19, 0x3d2822, 0x4d342b, 0x5d4035, 0x6e4e42, 0x876659];
def('ancient_debris_side', ({ rand }) => {
  const c = canvas();
  const wob = vnoise(rand, 4), nz = vnoise(rand, 16);
  const ph = rand() * TAU;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = (x + 2.2 * Math.sin(TAU * y / N + ph) + (wob(x, y) - 0.5) * 3) * 5 / N;
    const fr = v - Math.floor(v);
    let i = fr < 0.18 ? 0 : fr < 0.4 ? 2 : fr < 0.8 ? 3 : 4;
    if (nz(x, y) > 0.86) i = 5; else if (nz(x, y) < 0.1) i = 1;
    c.set(x, y, DEBRIS[i]);
  }
  return c;
});
def('ancient_debris_top', ({ rand }) => {
  const c = canvas();
  const nz = vnoise(rand, 16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const s = Math.hypot(dx, dy) / 2.3 + Math.atan2(dy, dx) / TAU;
    const fr = s - Math.floor(s);
    let i = fr < 0.25 ? 0 : fr < 0.5 ? 2 : fr < 0.85 ? 3 : 4;
    if (nz(x, y) > 0.88) i = 5;
    if (x === 0 || y === 0 || x === 15 || y === 15) i = 1;
    c.set(x, y, DEBRIS[i]);
  }
  return c;
});
const QUARTZ = [0xd6cfc4, 0xe0dacf, 0xe8e3db, 0xefebe4, 0xf7f4ef];
def('quartz_block_side', ({ rand }) => noiseTex(rand, [[4, 4, 0.3], [16, 16, 0.7]], QUARTZ.slice(1, 4), [22, 50, 28]));
def('quartz_block_top', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.3], [16, 16, 0.7]], QUARTZ.slice(1, 4), [22, 50, 28]);
  bevel(c, QUARTZ[4], QUARTZ[0]);
  for (let i = 2; i < 14; i++) { c.set(i, 2, QUARTZ[0]); c.set(2, i, QUARTZ[0]); c.set(i, 13, QUARTZ[4]); c.set(13, i, QUARTZ[4]); }
  return c;
});

// ===========================================================================
// ENCHANTING TABLE, ANVIL, LANTERN
// ===========================================================================
const CLOTH = [0x560b0b, 0x741313, 0x8c1b1b, 0xa12424, 0xb63434];
const clothTex = (rand) => noiseTex(rand, [[8, 8, 0.3], [16, 16, 0.7]], CLOTH.slice(1, 5), [15, 38, 32, 15]);
def('enchanting_table_top', ({ rand }) => {
  const c = clothTex(rand);
  for (let i = 0; i < N; i++) {
    c.set(i, 0, 0x120b0b); c.set(0, i, 0x120b0b); c.set(i, 15, 0x120b0b); c.set(15, i, 0x120b0b);
    if (i > 0 && i < 15) { c.set(i, 1, CLOTH[0]); c.set(1, i, CLOTH[0]); c.set(i, 14, CLOTH[0]); c.set(14, i, CLOTH[0]); }
  }
  for (const [x, y] of [[1, 1], [12, 1], [1, 12], [12, 12]]) {
    c.pattern(x, y, ['.c.', 'cCc', '.c.'], { c: 0x2fb8c4, C: 0xb8fff6 });
  }
  return c;
});
def('enchanting_table_side', ({ rand, get }) => {
  // visible part is rows 4-15: cloth hem on top, obsidian below
  const c = get('obsidian')[0].clone();
  const cl = clothTex(rand);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < 6; y++) c.set(x, y, cl.get(x, y));
    c.set(x, 4, x % 4 === 1 ? CLOTH[4] : CLOTH[3]);
    c.set(x, 5, x % 4 === 3 ? CLOTH[0] : CLOTH[1]);
    c.set(x, 6, 0x0e0909);
  }
  for (const x of [1, 14]) { c.set(x, 5, 0x2fb8c4); c.set(x, 4, 0xb8fff6); }
  return c;
});
def('enchanting_table_bottom', ({ get }) => get('obsidian')[0].clone());

const IRON_DARK = [0x2c2c2c, 0x363636, 0x3f3f3f, 0x474747, 0x505050, 0x5c5c5c];
def('anvil', ({ rand }) => {
  const c = noiseTex(rand, [[4, 4, 0.25], [8, 8, 0.3], [16, 16, 0.45]], IRON_DARK.slice(1), [12, 26, 32, 20, 10]);
  for (let k = 0; k < 9; k++) {
    const x = ri(rand, N), y = ri(rand, N), len = 2 + ri(rand, 3);
    for (let i = 0; i < len; i++) setW(c, x + i, y, IRON_DARK[5]);
    setW(c, x + len, y + 1, IRON_DARK[0]);
  }
  for (let k = 0; k < 6; k++) setW(c, ri(rand, N), ri(rand, N), IRON_DARK[0]);
  return c;
});
def('anvil_top', ({ rand, get }) => {
  const c = get('anvil')[0].clone();
  const pol = noiseTex(rand, FINE, [0x5a5a5a, 0x636363, 0x6b6b6b, 0x757575], [15, 35, 35, 15]);
  for (let y = 0; y < N; y++) {
    for (let x = 4; x < 12; x++) c.set(x, y, pol.get(x, y));
    c.set(3, y, 0x333333); c.set(12, y, 0x2a2a2a);
  }
  for (let k = 0; k < 5; k++) {
    const x = 4 + ri(rand, 6), y = ri(rand, N);
    c.set(x, y, 0x878787); c.set(x + 1, y, 0x7e7e7e);
  }
  return c;
});
def('lantern', () => {
  const c = canvas();
  const I = [0x1c2024, 0x2a3036, 0x394148, 0x4c565f];
  // body side 6x7 at (0,2): iron frame around glowing glass
  for (let y = 2; y <= 8; y++) for (let x = 0; x <= 5; x++) {
    if (y === 2) c.set(x, y, I[3]);
    else if (y === 8) c.set(x, y, I[0]);
    else if (x === 0) c.set(x, y, I[2]);
    else if (x === 5) c.set(x, y, I[1]);
  }
  c.pattern(1, 3, ['oyyo', 'yYYy', 'YWWY', 'yYYy', 'oyyo'], { o: 0xdf8e2a, y: 0xffc24a, Y: 0xffdc7a, W: 0xfff6c8 });
  // body top/bottom 6x6 at (0,9)
  for (let y = 9; y <= 14; y++) for (let x = 0; x <= 5; x++) {
    const edge = x === 0 || x === 5 || y === 9 || y === 14;
    const center = x >= 2 && x <= 3 && y >= 11 && y <= 12;
    c.set(x, y, edge ? (x === 0 || y === 9 ? I[2] : I[0]) : center ? I[3] : I[1]);
  }
  // cap sides 4x2 at (1,0)
  for (let x = 1; x <= 4; x++) { c.set(x, 0, I[3]); c.set(x, 1, I[1]); }
  // handle / chain loop 3x4 at (11,1)
  c.pattern(11, 1, ['.a.', 'a.b', 'a.b', '.b.'], { a: I[3], b: I[1] });
  return c;
});
def('soul_fire_0', ({ rand }) => fireFrames(rand, [0xe8ffff, 0xa6f4ff, 0x5ee2f2, 0x2fbcd8, 0x1e8fb5, 0x176b8c]));

// ===========================================================================
// BLOCK BREAKING OVERLAYS
// ===========================================================================
let crackCache = null;
function crackOrder() {
  if (crackCache) return crackCache;
  const rand = seeded('destroy_stage');
  const used = new Uint8Array(256);
  const order = [];
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const add = (x, y) => { used[y * N + x] = 1; order.push([x, y]); };
  const nb = (x, y) => { let n = 0; for (const [dx, dy] of DIRS) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < N && b < N && used[b * N + a]) n++; } return n; };
  add(7, 7); add(8, 8);
  const tips = [{ x: 8, y: 8, d0: 1, d: 1 }, { x: 7, y: 7, d0: 5, d: 5 }, { x: 8, y: 8, d0: 7, d: 7 }, { x: 7, y: 7, d0: 3, d: 3 }];
  let guard = 0;
  while (order.length < 150 && guard++ < 20000) {
    if (!tips.length) {
      const [sx, sy] = order[ri(rand, order.length)];
      const d = ri(rand, 8);
      tips.push({ x: sx, y: sy, d0: d, d });
    }
    const ti = order.length < 12 ? guard % tips.length : ri(rand, tips.length);
    const t = tips[ti];
    const r = rand();
    let d = t.d;
    if (r < 0.3) d = (t.d0 + 1) & 7; else if (r < 0.6) d = (t.d0 + 7) & 7; else d = t.d0;
    const nx = t.x + DIRS[d][0], ny = t.y + DIRS[d][1];
    if (nx < 0 || ny < 0 || nx > 15 || ny > 15 || used[ny * N + nx] || nb(nx, ny) > 2) {
      if (rand() < 0.3) tips.splice(ti, 1);
      continue;
    }
    add(nx, ny); t.x = nx; t.y = ny; t.d = d;
    if (rand() < 0.09) { const nd = (t.d0 + (rand() < 0.5 ? 2 : 6)) & 7; tips.push({ x: nx, y: ny, d0: nd, d: nd }); }
  }
  crackCache = order;
  return order;
}
const CRACK_COUNTS = [4, 10, 18, 28, 40, 54, 70, 88, 108, 132];
for (let s = 0; s < 10; s++) {
  def(`destroy_stage_${s}`, () => {
    const order = crackOrder();
    const c = canvas();
    const n = Math.min(order.length, CRACK_COUNTS[s]);
    for (let i = 0; i < n; i++) {
      const [x, y] = order[i];
      const v = 30 + ((x * 7 + y * 13) % 5) * 9;
      c.set(x, y, [v, v, v, 255]);
    }
    return c;
  });
}

// ===========================================================================
// public API
// ===========================================================================
export function fallbackTexture() {
  const c = canvas();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) c.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? 0x000000 : 0xf800f8);
  return c.data;
}

// Names this module can draw (without falling back).
export function blockTextureGeneratorNames() { return Object.keys(GEN); }

// Names that were requested but had no generator in the last generateBlockTextures() call.
export let lastFallbacks = [];

export function generateBlockTextures(names = null) {
  const cache = new Map();
  const stack = new Set();
  const get = (name) => {
    if (cache.has(name)) return cache.get(name);
    const fn = GEN[name];
    if (!fn || stack.has(name)) return null;
    stack.add(name);
    let out = fn({ rand: seeded(name), get, name });
    stack.delete(name);
    if (!Array.isArray(out)) out = [out];
    cache.set(name, out);
    return out;
  };
  const wanted = names ?? [...new Set([...collectBlockTextureNames(), ...Object.keys(GEN)])];
  const result = new Map();
  const fallbacks = [];
  for (const name of wanted) {
    const frames = get(name);
    if (!frames) { fallbacks.push(name); result.set(name, [fallbackTexture()]); continue; }
    result.set(name, frames.map((c) => c.data));
  }
  lastFallbacks = fallbacks;
  return result;
}

// Convenience: draw a single texture (first frame) by name.
export function generateBlockTexture(name) {
  return generateBlockTextures([name]).get(name);
}
