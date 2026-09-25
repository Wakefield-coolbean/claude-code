// Fast seeded noise for world generation (improved Perlin, 2D + 3D) and small RNG helpers.
// Kept separate from src/util/noise.js so terrain can be tuned without touching shared code.

// ---------- RNG ----------

// Integer hash of up to 4 ints -> uint32 (fast, good avalanche)
export function hash32(a, b, c, d) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15) ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13) ^ c, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16) ^ d, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// float in [0,1) from a position hash
export function hashf(a, b, c, d) {
  return hash32(a, b, c, d) / 4294967296;
}

// Small, allocation-free deterministic RNG (mulberry32 state machine).
export class Rng {
  constructor(seed = 0) { this.s = seed | 0; }
  seed(s) { this.s = s | 0; return this; }
  next() {
    let a = (this.s = (this.s + 0x6d2b79f5) | 0);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }
  float() { return this.next(); }
  int(n) { return (this.next() * n) | 0; }
  range(min, max) { return min + ((this.next() * (max - min + 1)) | 0); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[(this.next() * arr.length) | 0]; }
}

// ---------- Perlin ----------

// 12 edge gradients (+4 duplicates) for 3D improved noise, 8 directions for 2D.
const G3X = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0]);
const G3Y = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
const G3Z = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1]);
const G2X = new Float64Array(8), G2Y = new Float64Array(8);
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  G2X[i] = Math.cos(a) * 1.4142;
  G2Y[i] = Math.sin(a) * 1.4142;
}

export class Perlin {
  constructor(seed) {
    const r = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = r.int(i + 1);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    this.ox = r.next() * 256;
    this.oy = r.next() * 256;
    this.oz = r.next() * 256;
  }

  noise3(x, y, z) {
    x += this.ox; y += this.oy; z += this.oz;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const p = this.p;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    let h;
    h = p[AA] & 15; const g000 = G3X[h] * x + G3Y[h] * y + G3Z[h] * z;
    h = p[BA] & 15; const g100 = G3X[h] * x1 + G3Y[h] * y + G3Z[h] * z;
    h = p[AB] & 15; const g010 = G3X[h] * x + G3Y[h] * y1 + G3Z[h] * z;
    h = p[BB] & 15; const g110 = G3X[h] * x1 + G3Y[h] * y1 + G3Z[h] * z;
    h = p[AA + 1] & 15; const g001 = G3X[h] * x + G3Y[h] * y + G3Z[h] * z1;
    h = p[BA + 1] & 15; const g101 = G3X[h] * x1 + G3Y[h] * y + G3Z[h] * z1;
    h = p[AB + 1] & 15; const g011 = G3X[h] * x + G3Y[h] * y1 + G3Z[h] * z1;
    h = p[BB + 1] & 15; const g111 = G3X[h] * x1 + G3Y[h] * y1 + G3Z[h] * z1;
    const a0 = g000 + u * (g100 - g000), a1 = g010 + u * (g110 - g010);
    const b0 = g001 + u * (g101 - g001), b1 = g011 + u * (g111 - g011);
    const c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
    return c0 + w * (c1 - c0);
  }

  noise2(x, z) {
    x += this.ox; z += this.oz;
    const fx = Math.floor(x), fz = Math.floor(z);
    const X = fx & 255, Z = fz & 255;
    x -= fx; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const p = this.p;
    const A = p[X] + Z, B = p[X + 1] + Z;
    const x1 = x - 1, z1 = z - 1;
    let h;
    h = p[A] & 7; const g00 = G2X[h] * x + G2Y[h] * z;
    h = p[B] & 7; const g10 = G2X[h] * x1 + G2Y[h] * z;
    h = p[A + 1] & 7; const g01 = G2X[h] * x + G2Y[h] * z1;
    h = p[B + 1] & 7; const g11 = G2X[h] * x1 + G2Y[h] * z1;
    const a = g00 + u * (g10 - g00), b = g01 + u * (g11 - g01);
    return a + w * (b - a);
  }
}

// Fractal noise: `octaves` Perlin layers starting at frequency `freq` (per block),
// frequency x2 and amplitude x`persistence` per octave. Output normalised so that
// the amplitude sum is 1 (values mostly within [-0.7, 0.7]); multiply by `scale`.
export class Fractal {
  constructor(seed, octaves, freq, { persistence = 0.5, lacunarity = 2, scale = 1, yFreq = null } = {}) {
    this.n = [];
    this.f = new Float64Array(octaves);
    this.fy = new Float64Array(octaves);
    this.a = new Float64Array(octaves);
    let amp = 1, fr = freq, fry = yFreq ?? freq, norm = 0;
    for (let i = 0; i < octaves; i++) {
      this.n.push(new Perlin(hash32(seed, i, 0x51ed, octaves)));
      this.f[i] = fr; this.fy[i] = fry; this.a[i] = amp;
      norm += amp; amp *= persistence; fr *= lacunarity; fry *= lacunarity;
    }
    for (let i = 0; i < octaves; i++) this.a[i] *= scale / norm;
    this.count = octaves;
  }
  sample2(x, z) {
    let s = 0;
    const n = this.n, f = this.f, a = this.a;
    for (let i = 0; i < this.count; i++) s += n[i].noise2(x * f[i], z * f[i]) * a[i];
    return s;
  }
  sample3(x, y, z) {
    let s = 0;
    const n = this.n, f = this.f, fy = this.fy, a = this.a;
    for (let i = 0; i < this.count; i++) s += n[i].noise3(x * f[i], y * fy[i], z * f[i]) * a[i];
    return s;
  }
}

// ---------- small math helpers ----------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, v) {
  let t = (v - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Piecewise-linear spline through (xs[i], ys[i]); xs ascending. Clamps at ends.
export function makeSpline(xs, ys) {
  const n = xs.length;
  const X = Float64Array.from(xs), Y = Float64Array.from(ys);
  return (v) => {
    if (v <= X[0]) return Y[0];
    if (v >= X[n - 1]) return Y[n - 1];
    let i = 1;
    while (v > X[i]) i++;
    const t = (v - X[i - 1]) / (X[i] - X[i - 1]);
    // smooth (cubic hermite-ish) interpolation between knots for softer terrain
    const s = t * t * (3 - 2 * t);
    const tt = t * 0.5 + s * 0.5;
    return Y[i - 1] + (Y[i] - Y[i - 1]) * tt;
  };
}
