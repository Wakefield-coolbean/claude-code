// Seeded gradient noise (improved Perlin / simplex) used by world generation.
import { mulberry32 } from './rng.js';

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export class Noise {
  constructor(seed) {
    const rand = mulberry32(seed | 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
    // random offsets so octaves differ
    this.ox = rand() * 256; this.oy = rand() * 256; this.oz = rand() * 256;
  }

  // 2D simplex noise, returns roughly [-1, 1]
  noise2(xin, yin) {
    const perm = this.perm, pm = this.permMod12;
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    xin += this.ox; yin += this.oy;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const g = pm[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const g = pm[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const g = pm[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  // 3D improved Perlin noise, returns roughly [-1, 1]
  noise3(x, y, z) {
    const p = this.perm;
    x += this.ox; y += this.oy; z += this.oz;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    return lerp(w,
      lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)),
        lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))));
  }
}

function lerp(t, a, b) { return a + t * (b - a); }
function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// Fractal (octave) noise. amplitude halves and frequency doubles each octave by default.
export class OctaveNoise {
  constructor(seed, octaves, { persistence = 0.5, lacunarity = 2 } = {}) {
    this.octaves = [];
    for (let i = 0; i < octaves; i++) this.octaves.push(new Noise((seed * 31 + i * 1013904223) | 0));
    this.persistence = persistence;
    this.lacunarity = lacunarity;
    let norm = 0, a = 1;
    for (let i = 0; i < octaves; i++) { norm += a; a *= persistence; }
    this.norm = 1 / norm;
  }
  noise2(x, y) {
    let sum = 0, amp = 1, freq = 1;
    for (const o of this.octaves) {
      sum += o.noise2(x * freq, y * freq) * amp;
      amp *= this.persistence; freq *= this.lacunarity;
    }
    return sum * this.norm;
  }
  noise3(x, y, z) {
    let sum = 0, amp = 1, freq = 1;
    for (const o of this.octaves) {
      sum += o.noise3(x * freq, y * freq, z * freq) * amp;
      amp *= this.persistence; freq *= this.lacunarity;
    }
    return sum * this.norm;
  }
}
