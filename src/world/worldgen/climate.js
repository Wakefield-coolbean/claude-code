// Multi-noise climate + terrain shaping (Minecraft 1.18 style).
//
// Six 2D parameters are sampled per column: continentalness (C), erosion (E), weirdness (W,
// folded into peaks & valleys PV), temperature (T), humidity (Hm) and a river ridge. Each noise
// is "uniformised" to roughly [-1, 1] with a flat distribution so spline knots map to area
// fractions. A spline stack turns (C, E, PV) into a base surface height and a 3D noise
// amplitude, rivers carve valleys, and biomes are chosen from the parameters + final height.
import { BIOME } from '../../registry/biomes.js';
import { Fractal, hash32, smoothstep, makeSpline } from './noise.js';

const SEA = 63;

// tanh-based erf approximation (max error ~ 4e-4)
function erf(x) { return Math.tanh(x * (1.128379167 + 0.10091 * x * x)); }

// Standard deviation of a Fractal's output for a given octave count/persistence (seed independent
// in practice). Measured once with a fixed seed so results never depend on the world seed.
const sdCache = new Map();
export function fractalSd(octaves, persistence = 0.5) {
  const key = octaves + ':' + persistence;
  let sd = sdCache.get(key);
  if (sd !== undefined) return sd;
  const f = new Fractal(918273, octaves, 1 / 97.31, { persistence });
  let s2 = 0, n = 0;
  for (let i = 0; i < 160; i++) {
    for (let j = 0; j < 160; j++) {
      const v = f.sample2(i * 23.7 + 0.31, j * 19.3 + 0.77);
      s2 += v * v; n++;
    }
  }
  sd = Math.sqrt(s2 / n);
  sdCache.set(key, sd);
  return sd;
}

// Fractal noise normalised to N(0,1) (raw) or ~uniform [-1,1] (uni)
export class NNoise {
  constructor(seed, octaves, freq, persistence = 0.5) {
    this.f = new Fractal(seed, octaves, freq, { persistence });
    this.k = 1 / fractalSd(octaves, persistence);
  }
  raw(x, z) { return this.f.sample2(x, z) * this.k; }
  uni(x, z) { return erf(this.f.sample2(x, z) * this.k * Math.SQRT1_2); }
}

// ---- terrain splines (inputs are uniformised params) ----
// continentalness -> base height (ocean floors .. inland plains)
const contSpline = makeSpline(
  [-1, -0.78, -0.66, -0.55, -0.45, -0.39, -0.35, -0.31, -0.25, -0.15, 0.15, 0.55, 1],
  [24, 30, 37, 43, 47, 52, 57.5, 62.3, 64.3, 65.5, 68, 72, 76],
);
// erosion -> mountain amplitude (0..1)
const erosionSpline = makeSpline(
  [-1, -0.78, -0.55, -0.3, -0.05, 0.25, 0.55, 1],
  [1.0, 0.8, 0.52, 0.28, 0.15, 0.065, 0.022, 0.01],
);
// peaks & valleys -> mountain shape (0..1)
const pvSpline = makeSpline(
  [-1, -0.6, -0.2, 0.2, 0.5, 0.8, 1],
  [0, 0.03, 0.13, 0.32, 0.58, 0.86, 1],
);

// ---- biome tables (rows: temperature 0..4, cols: humidity 0..4) ----
const b = (n) => BIOME[n] ?? BIOME.plains;
const MIDDLE = [
  ['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'taiga'],
  ['plains', 'plains', 'forest', 'taiga', 'taiga'],
  ['plains', 'plains', 'forest', 'birch_forest', 'dark_forest'],
  ['savanna', 'savanna', 'plains', 'forest', 'jungle'],
  ['desert', 'desert', 'desert', 'desert', 'desert'],
].map((r) => r.map(b));
const MIDDLE_VARIANT = [
  ['snowy_plains', null, 'snowy_taiga', null, null],
  [null, null, null, null, 'taiga'],
  ['flower_forest', 'sunflower_plains', null, 'birch_forest', null],
  [null, null, null, null, 'jungle'],
  [null, null, null, null, null],
].map((r) => r.map((n) => (n ? b(n) : -1)));
const PLATEAU = [
  ['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'snowy_taiga'],
  ['meadow', 'meadow', 'forest', 'taiga', 'taiga'],
  ['meadow', 'meadow', 'meadow', 'meadow', 'dark_forest'],
  ['savanna', 'savanna', 'forest', 'forest', 'jungle'],
  ['badlands', 'badlands', 'badlands', 'badlands', 'badlands'],
].map((r) => r.map(b));

// Band edges on the uniformised [-1, 1] parameters: extremes (frozen, desert) are narrow and the
// temperate bands wide, and the two driest humidity bands (plains) cover about half the range.
function tempIndex(t) { return t < -0.74 ? 0 : t < -0.32 ? 1 : t < 0.3 ? 2 : t < 0.76 ? 3 : 4; }
function humidIndex(h) { return h < -0.45 ? 0 : h < 0.05 ? 1 : h < 0.35 ? 2 : h < 0.68 ? 3 : 4; }

// Sample record (reused, never allocated per call)
export function makeSample() {
  return {
    C: 0, E: 0, W: 0, PV: 0, T: 0, Hm: 0,
    H: 64, amp: 3, mtn: 0, river: 0, riverScale: 0, riverChannel: false, swamp: 0,
    ti: 2, hi: 2, biome: 0,
  };
}

export class Climate {
  constructor(seed, type = 'default') {
    const s = type === 'large_biomes' ? 0.25 : 1;
    this.amplified = type === 'amplified';
    const h = (k) => hash32(seed, k, 0x7a3b, 0x1f);
    this.cont = new NNoise(h(1), 6, s / 2600);
    this.contWarpX = new Fractal(h(2), 3, s / 900);
    this.contWarpZ = new Fractal(h(3), 3, s / 900);
    this.eros = new NNoise(h(4), 4, s / 1400);
    this.weird = new NNoise(h(5), 4, s / 720);
    this.temp = new NNoise(h(6), 2, s / 3000, 0.4);
    this.humid = new NNoise(h(7), 2, s / 2400, 0.45);
    this.biomeJitter = new Fractal(h(8), 2, 1 / 18);
    this.riverN = new NNoise(h(9), 3, 1 / (1200 * (s === 1 ? 1 : 2)), 0.45);
    this.riverWarpX = new Fractal(h(10), 2, 1 / 260);
    this.riverWarpZ = new Fractal(h(11), 2, 1 / 260);
    this.hills = new NNoise(h(12), 3, 1 / 190);
    this.jag = new NNoise(h(13), 2, 1 / 46);
    this.peakJit = new Fractal(h(14), 2, 1 / 90);
  }

  // Fill `o` with the full 2D sample for column (x, z). Pure function of (seed, x, z).
  sample(x, z, o) {
    const wx = x + this.contWarpX.sample2(x, z) * 380;
    const wz = z + this.contWarpZ.sample2(x, z) * 380;
    const C = this.cont.uni(wx, wz);
    const E = this.eros.uni(x, z);
    const W = this.weird.uni(x, z);
    const aw = W < 0 ? -W : W;
    const d3 = 3 * aw - 2;
    const PV = 1 - (d3 < 0 ? -d3 : d3);
    const jit = this.biomeJitter.sample2(x, z) * 0.035;
    const T = this.temp.uni(x, z) + jit;
    const Hm = this.humid.uni(x, z) - jit;

    // --- height ---
    const base = contSpline(C);
    const I = smoothstep(-0.3, 0.1, C);
    const M = erosionSpline(E);
    const P = pvSpline(PV);
    const mtn = I * M * P; // 0..1 "mountainness"
    let H = base + mtn * (this.amplified ? 360 : 185);
    const hn = this.hills.raw(x, z);
    const hillAmp = (1.4 + 7.5 * (1 - smoothstep(-0.3, 0.7, E))) * smoothstep(-0.38, -0.26, C) * (1 - 0.6 * mtn);
    H += (hn > 0 ? hn : hn * 0.3) * hillAmp; // hills rarely dip below the base level (few puddles)
    H += hn * 3 * (1 - smoothstep(-0.43, -0.31, C)); // ocean floor relief
    // jagged peaks
    const jagAmt = I * smoothstep(-0.4, -0.82, E) * smoothstep(0.5, 0.9, PV);
    if (jagAmt > 0) {
      const j = this.jag.raw(x, z) * 0.5;
      H += jagAmt * (this.amplified ? 48 : 32) * (j > 0 ? j : j * 0.5);
    }
    // swamps: very flat, sea level, in temperate zones
    const tMask = smoothstep(-0.72, -0.6, T) * (1 - smoothstep(0.58, 0.68, T));
    const swamp = smoothstep(0.56, 0.7, E) * tMask * smoothstep(-0.2, -0.08, C) * (1 - smoothstep(0.35, 0.6, PV));
    if (swamp > 0) H += (62.6 + hn * 1.1 - H) * swamp;

    // --- rivers ---
    const rwx = x + this.riverWarpX.sample2(x, z) * 70;
    const rwz = z + this.riverWarpZ.sample2(x, z) * 70;
    let rv = this.riverN.raw(rwx, rwz);
    if (rv < 0) rv = -rv;
    const riverScale = (1 - smoothstep(0.28, 0.5, mtn)) * smoothstep(-0.42, -0.33, C);
    const preH = H;
    const rw = 0.05, vw = 0.26;
    let channel = false;
    let amp = 2.2 + I * 34 * M * (0.3 + 0.7 * P);
    if (riverScale > 0 && rv < rw + vw * 3) {
      let prof;
      if (rv < rw) { const t = rv / rw; prof = 56.5 + 5.8 * t * t; } else {
        const t = (rv - rw) / vw;
        prof = 62.3 + Math.pow(t, 1.35) * 55;
      }
      if (prof < H) H += (prof - H) * riverScale;
      amp *= 1 - riverScale * (1 - smoothstep(0, 1.4, (rv - rw) / vw));
      if (H < SEA && preH >= 60.5 && rv < rw * 1.6 && riverScale > 0.5) channel = true;
    }
    if (this.amplified) amp *= 1.6;
    if (H > 290) H = 290;

    o.C = C; o.E = E; o.W = W; o.PV = PV; o.T = T; o.Hm = Hm;
    o.H = H; o.amp = amp; o.mtn = mtn; o.river = rv; o.riverScale = riverScale; o.riverChannel = channel;
    o.swamp = swamp;
    o.ti = tempIndex(T); o.hi = humidIndex(Hm);
    o.biome = this.pickBiome(o, x, z);
    return o;
  }

  pickBiome(o, x, z) {
    const { C, E, W, H, ti, hi } = o;
    if (o.riverChannel) return ti === 0 ? BIOME.frozen_river : BIOME.river;
    if ((C < -0.36 && H < 61) || (C < -0.2 && H < 60)) {
      const deep = C < -0.64 || H < 38;
      if (ti === 0) return BIOME.frozen_ocean;
      if (ti === 1) return deep ? BIOME.deep_ocean : BIOME.cold_ocean;
      if (ti === 2) return deep ? BIOME.deep_ocean : BIOME.ocean;
      if (ti === 3) return BIOME.lukewarm_ocean;
      return deep ? BIOME.lukewarm_ocean : BIOME.warm_ocean;
    }
    if (C < -0.22 && H < 67.5 && o.swamp < 0.3) {
      if (o.mtn > 0.12 || E < -0.55) return BIOME.stony_shore;
      if (ti === 0) return BIOME.snowy_beach;
      if (ti === 4) return BIOME.desert;
      return BIOME.beach;
    }
    const pj = this.peakJit.sample2(x, z) * 16;
    if (H > 158 + pj && o.mtn > 0.45) {
      if (ti <= 2) return W < 0 ? BIOME.jagged_peaks : BIOME.frozen_peaks;
      if (ti === 3) return BIOME.stony_peaks;
      return BIOME.badlands;
    }
    if (H > 122 + pj && o.mtn > 0.3) {
      if (ti <= 2) return hi <= 1 ? BIOME.snowy_slopes : BIOME.grove;
      if (ti === 3) return H > 140 + pj ? BIOME.stony_peaks : (hi <= 1 ? BIOME.savanna : BIOME.forest);
      return BIOME.badlands;
    }
    if (H > 92 + pj * 0.5 && o.mtn > 0.1) {
      if (ti <= 2 && W > 0.15 && E > -0.6 && E < 0.05 && hi <= 3) return BIOME.windswept_hills;
      if (ti === 4 && (H < 100 || o.mtn < 0.2)) return BIOME.desert;
      return PLATEAU[ti][hi];
    }
    if (o.swamp > 0.5 && ti >= 1 && ti <= 3) return BIOME.swamp;
    if (W > 0) {
      const v = MIDDLE_VARIANT[ti][hi];
      if (v >= 0) return v;
    }
    return MIDDLE[ti][hi];
  }
}
