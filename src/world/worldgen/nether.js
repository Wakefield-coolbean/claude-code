// Nether dimension generator (Java 1.16-1.18 feel). Same interface as the overworld WorldGenerator.
//
// The Nether occupies world y 0..127 of the normal column (other sections are null):
//   - 3D density noise on a 4x4x4 grid (trilinear) -> netherrack caverns, ledges, overhangs, pillars
//   - lava sea: every air block at y <= 31 becomes lava; bedrock floor (0..4) and ceiling (123..127)
//   - multi-noise biomes (temperature/humidity points like MC): nether_wastes, crimson_forest,
//     warped_forest, soul_sand_valley, basalt_deltas
//   - surface rules per biome, magma/gravel/blackstone/soul sand blobs, quartz/gold/ancient debris
//   - in-column decoration (roots, fungi, fire, soul fire, lava springs) and multi-chunk features
//     (glowstone clusters, huge fungi, basalt pillars/columns, delta lava pools) via placeFeature
//   - nether fortresses (see fortress.js), written slice-by-slice inside generateColumn
import { SECTION_COUNT, packBlock } from '../../constants.js';
import { BIOME } from '../../registry/biomes.js';
import { IS_SOLID } from '../../registry/blocks.js';
import { Fractal, Rng, hash32, hashf } from './noise.js';
import { NNoise } from './climate.js';
import { placeVeinList, T_STONE, T_BASE } from './ores.js';
import { FortressPlanner } from './fortress.js';
import * as I from './ids.js';

const HEIGHT = 128;
const LAVA_SEA = 31;
const NYC = HEIGHT / 4 + 1;       // 33 corner rows (4-block cells)
const SD3_4 = 0.150, SD3_2 = 0.198; // std-dev of the 4-octave (persistence 0.62) / 2-octave 3D fractals
const at = (y, col) => ((y + 64) << 8) | col;
const { AIR, LAVA, NETHERRACK, BEDROCK } = I;

const B = (n, fb = 'plains') => BIOME[n] ?? BIOME[fb];
const WASTES = B('nether_wastes'), CRIMSON = B('crimson_forest'), WARPED = B('warped_forest');
const SOUL = B('soul_sand_valley'), DELTAS = B('basalt_deltas');
// multi-noise biome points: [biome, temperature, humidity, offset]
const POINTS = [[WASTES, 0, 0, 0], [SOUL, 0, -1.15, 0.1], [CRIMSON, 1.15, 0, 0], [WARPED, 0, 1.15, 0.25], [DELTAS, -1.15, 0, 0.2]];

const TARGET = new Uint8Array(4096);
TARGET[NETHERRACK] = T_STONE | T_BASE;
TARGET[I.BASALT] = T_BASE;
TARGET[I.BLACKSTONE] = T_BASE;

const DELTA_SET = new Set(['basalt_deltas']);
const SOUL_SET = new Set(['soul_sand_valley']);
const VEINS = [
  { kind: 'blob', block: I.MAGMA_BLOCK, count: 4, dist: 'u', min: 27, max: 36, size: 33, mask: T_STONE },
  { kind: 'blob', block: I.GRAVEL, count: 2, dist: 'u', min: 5, max: 41, size: 33, mask: T_STONE },
  { kind: 'blob', block: I.BLACKSTONE, count: 2, dist: 'u', min: 5, max: 31, size: 33, mask: T_STONE },
  { kind: 'blob', block: I.SOUL_SAND, count: 12, dist: 'u', min: 0, max: 31, size: 12, mask: T_STONE, biomes: SOUL_SET },
  { kind: 'ore', ore: I.NETHER_QUARTZ_ORE, deep: I.NETHER_QUARTZ_ORE, count: 16, dist: 'u', min: 10, max: 117, size: 14 },
  { kind: 'ore', ore: I.NETHER_GOLD_ORE, deep: I.NETHER_GOLD_ORE, count: 10, dist: 'u', min: 10, max: 117, size: 10 },
  { kind: 'ore', ore: I.NETHER_QUARTZ_ORE, deep: I.NETHER_QUARTZ_ORE, count: 16, dist: 'u', min: 10, max: 117, size: 14, biomes: DELTA_SET },
  { kind: 'ore', ore: I.NETHER_GOLD_ORE, deep: I.NETHER_GOLD_ORE, count: 10, dist: 'u', min: 10, max: 117, size: 10, biomes: DELTA_SET },
  // ancient debris: 1-2 tiny veins per chunk, triangle 8..22 (peak 15), never exposed to air/lava
  { kind: 'ore', ore: I.ANCIENT_DEBRIS, deep: I.ANCIENT_DEBRIS, count: 1, dist: 't', min: 8, max: 22, size: 5, discard: 1 },
  { kind: 'ore', ore: I.ANCIENT_DEBRIS, deep: I.ANCIENT_DEBRIS, rarity: 2, dist: 't', min: 8, max: 22, size: 4, discard: 1 },
];
VEINS.forEach((v, i) => { v.salt = 0x4e7 + i * 7919; });

const OPEN = new Uint8Array(4096); // non-solid for surface purposes
OPEN[AIR] = 1; OPEN[LAVA] = 1; OPEN[I.FIRE] = 1; OPEN[I.SOUL_FIRE] = 1;
const ROCK = new Uint8Array(4096);
for (const b of [NETHERRACK, I.BASALT, I.BLACKSTONE, I.SOUL_SAND, I.SOUL_SOIL, I.CRIMSON_NYLIUM, I.WARPED_NYLIUM, I.GRAVEL,
  I.MAGMA_BLOCK, I.NETHER_QUARTZ_ORE, I.NETHER_GOLD_ORE, I.GLOWSTONE, I.NETHER_BRICKS]) ROCK[b] = 1;

export class NetherGenerator {
  constructor(seed, options = {}) {
    this.seed = seed | 0;
    this.dimension = 'nether';
    this.type = options.type ?? 'default';
    const h = (k) => hash32(this.seed, k, 0x4e7e, 0x11);
    this.n3 = new Fractal(h(1), 4, 1 / 68, { yFreq: 1 / 26, persistence: 0.62 });
    this.mass = new Fractal(h(2), 2, 1 / 240, { yFreq: 1 / 120 });
    this.detail = new Fractal(h(10), 1, 1 / 15, { yFreq: 1 / 9 });
    this.temp = new NNoise(h(3), 2, 1 / 320);
    this.humid = new NNoise(h(4), 2, 1 / 320);
    this.warpX = new Fractal(h(5), 2, 1 / 90);
    this.warpZ = new Fractal(h(6), 2, 1 / 90);
    this.surfN = new Fractal(h(7), 2, 1 / 16);
    this.patchN = new Fractal(h(8), 2, 1 / 30, { yFreq: 1 / 12 });
    this.fireN = new Fractal(h(9), 1, 1 / 20);
    this.fort = new FortressPlanner(this.seed);
    this.buf = new Uint16Array(384 * 256);
    this.colBiome = new Uint8Array(256);
    this.D = new Float32Array(5 * 5 * NYC);
    this._spawn = null;
  }

  // ------------------------------------------------------------------------------------------
  getBiomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const wx = x + this.warpX.sample2(x, z) * 40, wz = z + this.warpZ.sample2(x, z) * 40;
    const t = this.temp.uni(wx, wz), hm = this.humid.uni(wx, wz);
    let best = WASTES, bd = Infinity;
    for (const [b, pt, ph, off] of POINTS) {
      const d = (t - pt) * (t - pt) + (hm - ph) * (hm - ph) + off * off;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  getHeightEstimate() { return 64; }

  findNearestFortress(x, z) { return this.fort.nearest(Math.floor(x), Math.floor(z)); }

  getSpawnPoint() {
    if (this._spawn) return { ...this._spawn };
    let pick = null;
    for (let ring = 0; ring < 6 && !pick; ring++) {
      for (let cz = -ring; cz <= ring && !pick; cz++) {
        for (let cx = -ring; cx <= ring && !pick; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== ring) continue;
          const col = this.generateColumn(cx, cz);
          const get = (lx, y, lz) => { const s = col.sections[(y + 64) >> 4]; return s ? s[((y + 64) & 15) * 256 + lz * 16 + lx] & 0xfff : 0; };
          let bestScore = Infinity;
          for (let lz = 2; lz < 14; lz++) for (let lx = 2; lx < 14; lx++) {
            for (let y = 36; y < 110; y++) {
              const g = get(lx, y - 1, lz);
              if (!IS_SOLID[g] || g === I.MAGMA_BLOCK || g === I.NETHER_BRICK_FENCE) continue;
              if (get(lx, y, lz) || get(lx, y + 1, lz) || get(lx, y + 2, lz)) continue;
              const score = Math.abs(y - 70) + Math.abs(lx - 8) + Math.abs(lz - 8);
              if (score < bestScore) { bestScore = score; pick = { x: cx * 16 + lx, y, z: cz * 16 + lz }; }
            }
          }
        }
      }
    }
    this._spawn = pick ?? { x: 8, y: 70, z: 8 };
    return { ...this._spawn };
  }

  placeFeature(access, f) {
    switch (f.type) {
      case 'glowstone': return glowstone(access, f);
      case 'huge_fungus': return hugeFungus(access, f);
      case 'basalt_pillar': return basaltPillar(access, f);
      case 'basalt_columns': return basaltColumns(access, f);
      case 'delta': return delta(access, f);
      default: return false;
    }
  }

  // ------------------------------------------------------------------------------------------
  generateColumn(cx, cz) {
    const X0 = cx << 4, Z0 = cz << 4;
    const buf = this.buf;
    buf.fill(0);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) this.colBiome[(lz << 4) | lx] = this.getBiomeAt(X0 + lx, Z0 + lz);
    this._terrain(X0, Z0);
    this._surface(X0, Z0);
    placeVeinList({
      cx, cz, buf, seed: this.seed, topMax: 126, minY: 1, maxY: 126,
      biomeNameAt: (x, z) => {
        const lx = x - X0, lz = z - Z0;
        const b = lx >= 0 && lx < 16 && lz >= 0 && lz < 16 ? this.colBiome[(lz << 4) | lx] : this.getBiomeAt(x, z);
        return b === DELTAS ? 'basalt_deltas' : b === SOUL ? 'soul_sand_valley' : 'other';
      },
    }, VEINS, TARGET);
    this._decorate(X0, Z0);
    const nFort = this.fort.writeChunk(cx, cz, buf);
    const features = this._features(cx, cz, nFort > 0);
    return this._output(features);
  }

  _terrain(X0, Z0) {
    const { buf, D } = this;
    const seed = this.seed;
    for (let gx = 0; gx <= 4; gx++) {
      for (let gz = 0; gz <= 4; gz++) {
        const x = X0 + gx * 4, z = Z0 + gz * 4;
        const base = (gx * 5 + gz) * NYC;
        for (let gy = 0; gy < NYC; gy++) {
          const y = gy * 4;
          const b = bias(y);
          let d;
          if (b > 2.5 || b < -2.5) d = b;
          else d = (this.n3.sample3(x, y, z) / SD3_4) * 0.62 + (this.mass.sample3(x, y, z) / SD3_2) * 0.32 + (this.detail.sample3(x, y, z) / 0.275) * 0.2 + b;
          D[base + gy] = d;
        }
      }
    }
    for (let ci = 0; ci < 4; ci++) {
      for (let cj = 0; cj < 4; cj++) {
        const b00 = (ci * 5 + cj) * NYC, b10 = ((ci + 1) * 5 + cj) * NYC, b01 = (ci * 5 + cj + 1) * NYC, b11 = ((ci + 1) * 5 + cj + 1) * NYC;
        for (let lx = 0; lx < 4; lx++) {
          const fx = lx * 0.25;
          for (let lz = 0; lz < 4; lz++) {
            const fz = lz * 0.25;
            const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
            const col = ((cj * 4 + lz) << 4) | (ci * 4 + lx);
            for (let cy = 0; cy < NYC - 1; cy++) {
              const d0 = D[b00 + cy] * w00 + D[b10 + cy] * w10 + D[b01 + cy] * w01 + D[b11 + cy] * w11;
              const d1 = D[b00 + cy + 1] * w00 + D[b10 + cy + 1] * w10 + D[b01 + cy + 1] * w01 + D[b11 + cy + 1] * w11;
              for (let ly = 0; ly < 4; ly++) {
                const y = cy * 4 + ly;
                const d = d0 + (d1 - d0) * ly * 0.25;
                buf[at(y, col)] = d > 0 ? NETHERRACK : y <= LAVA_SEA ? LAVA : AIR;
              }
            }
          }
        }
      }
    }
    // bedrock floor and ceiling
    for (let col = 0; col < 256; col++) {
      const x = X0 + (col & 15), z = Z0 + (col >> 4);
      buf[at(0, col)] = BEDROCK;
      buf[at(127, col)] = BEDROCK;
      for (let k = 1; k <= 4; k++) {
        if (hashf(x, k, z, seed ^ 0xbed0) < (5 - k) / 5) buf[at(k, col)] = BEDROCK;
        if (hashf(x, 127 - k, z, seed ^ 0xbed1) < (5 - k) / 5) buf[at(127 - k, col)] = BEDROCK;
      }
    }
  }

  _surface(X0, Z0) {
    const buf = this.buf;
    const up = new Uint8Array(HEIGHT), down = new Uint8Array(HEIGHT);
    for (let col = 0; col < 256; col++) {
      const x = X0 + (col & 15), z = Z0 + (col >> 4);
      const b = this.colBiome[col];
      const sn = this.surfN.sample2(x, z) / 0.228;
      if (b === DELTAS) {
        // distance to open space above / below; exposed netherrack -> basalt / blackstone
        let d = 9;
        for (let y = 126; y >= 1; y--) { d = OPEN[buf[at(y + 1, col)]] ? 0 : Math.min(9, d + 1); up[y] = d; }
        d = 9;
        for (let y = 1; y <= 126; y++) { d = OPEN[buf[at(y - 1, col)]] ? 0 : Math.min(9, d + 1); down[y] = d; }
        for (let y = 5; y <= 122; y++) {
          const i = at(y, col);
          if (buf[i] !== NETHERRACK) continue;
          const dd = Math.min(up[y], down[y]);
          if (dd > 2 + (sn > 0 ? 1 : 0)) continue;
          const p = this.patchN.sample3(x, y, z) / SD3_2;
          buf[i] = p > 0.35 ? I.BLACKSTONE : I.BASALT;
        }
        continue;
      }
      let depth = 0, openAbove = false, lavaAbove = false;
      for (let y = 126; y >= 1; y--) {
        const i = at(y, col);
        const v = buf[i];
        if (OPEN[v]) { depth = 0; openAbove = true; lavaAbove = v === LAVA; continue; }
        const dFloor = openAbove ? depth : 99;
        depth++;
        if (v !== NETHERRACK || dFloor > 3) continue;
        if (b === CRIMSON || b === WARPED) {
          if (dFloor === 0 && !lavaAbove && y > LAVA_SEA) buf[i] = b === CRIMSON ? I.CRIMSON_NYLIUM : I.WARPED_NYLIUM;
          else if (dFloor <= 1 && y >= 27 && y <= 34 && sn < -0.6) buf[i] = I.GRAVEL;
        } else if (b === SOUL) {
          if (dFloor <= 2 + (sn > 0.5 ? 1 : 0)) {
            const p = this.patchN.sample3(x, y * 0.5, z) / SD3_2;
            buf[i] = p > 0.15 ? I.SOUL_SOIL : I.SOUL_SAND;
          }
        } else if (y >= 26 && y <= 35 && dFloor <= 1) {
          // nether wastes "beaches" around the lava sea
          if (sn > 0.45) buf[i] = I.SOUL_SAND;
          else if (sn < -0.5) buf[i] = I.GRAVEL;
        }
      }
    }
  }

  _decorate(X0, Z0) {
    const buf = this.buf, seed = this.seed;
    for (let col = 0; col < 256; col++) {
      const x = X0 + (col & 15), z = Z0 + (col >> 4);
      const b = this.colBiome[col];
      const fire = b === WASTES ? this.fireN.sample2(x, z) / 0.309 : -9;
      for (let y = LAVA_SEA + 1; y <= 121; y++) {
        const i = at(y, col);
        if (buf[i] !== AIR) continue;
        const g = buf[i - 256];
        if (!IS_SOLID[g & 0xfff]) continue;
        const r = hashf(x, y, z, seed ^ 0xdec0);
        if (g === I.CRIMSON_NYLIUM) {
          if (r < 0.2) buf[i] = I.CRIMSON_ROOTS;
          else if (r < 0.245) buf[i] = I.CRIMSON_FUNGUS;
          else if (r < 0.25) buf[i] = I.WARPED_FUNGUS;
        } else if (g === I.WARPED_NYLIUM) {
          if (r < 0.2) buf[i] = I.WARPED_ROOTS;
          else if (r < 0.245) buf[i] = I.WARPED_FUNGUS;
          else if (r < 0.25) buf[i] = I.CRIMSON_FUNGUS;
        } else if (g === NETHERRACK && fire > 0.9 && r < 0.3) {
          buf[i] = I.FIRE;
        } else if (g === I.SOUL_SOIL && r < 0.02) {
          buf[i] = I.SOUL_FIRE;
        }
      }
    }
    // lava springs in walls: netherrack with exactly one open horizontal side, rock above and below
    const r = new Rng(hash32(seed, X0, Z0, 0x5921));
    const n = 10;
    for (let k = 0; k < n; k++) {
      const lx = 1 + r.int(14), lz = 1 + r.int(14), y = 8 + r.int(112);
      const col = (lz << 4) | lx;
      const i = at(y, col);
      const v = buf[i];
      if (v !== NETHERRACK && v !== I.BASALT && v !== I.BLACKSTONE) continue;
      if (!ROCK[buf[i + 256]] || !ROCK[buf[i - 256]]) continue;
      let open = 0, rock = 0;
      for (const o of [1, -1, 16, -16]) { const c = buf[i + o]; if (c === AIR) open++; else if (ROCK[c]) rock++; }
      if (open === 1 && rock === 3) buf[i] = LAVA;
    }
  }

  _features(cx, cz, nearFort) {
    const buf = this.buf, seed = this.seed;
    const X0 = cx << 4, Z0 = cz << 4;
    const features = [];
    const r = new Rng(hash32(seed, cx, cz, 0xfea7));
    const blocked = (x, y, z) => nearFort && this.fort.inside(x, y, z, 4);
    const floorFrom = (col, y) => { // first air-over-solid scanning down (y >= 33)
      for (; y > LAVA_SEA + 1; y--) if (buf[at(y, col)] === AIR && IS_SOLID[buf[at(y - 1, col)] & 0xfff]) return y;
      return -1;
    };
    const ceilFrom = (col, y) => { // first air-under-solid scanning up
      for (; y < 122; y++) if (buf[at(y, col)] === AIR && ROCK[buf[at(y + 1, col)]]) return y;
      return -1;
    };
    const mid = this.colBiome[8 * 16 + 8];
    // glowstone clusters hanging from ceilings
    const gTries = mid === WASTES ? 6 : mid === SOUL ? 2 : 3;
    for (let k = 0; k < gTries; k++) {
      const lx = r.int(16), lz = r.int(16), y0 = 40 + r.int(70), s = r.int(0x7fffffff);
      const y = ceilFrom((lz << 4) | lx, y0);
      if (y < 0 || blocked(X0 + lx, y, Z0 + lz)) continue;
      features.push({ type: 'glowstone', x: X0 + lx, y, z: Z0 + lz, seed: s });
    }
    // biome features
    for (let k = 0; k < 10; k++) {
      const lx = r.int(16), lz = r.int(16), y0 = 40 + r.int(80), s = r.int(0x7fffffff), roll = r.next();
      const col = (lz << 4) | lx;
      const b = this.colBiome[col];
      const x = X0 + lx, z = Z0 + lz;
      if (b === CRIMSON || b === WARPED) {
        if (k >= 8) continue;
        const y = floorFrom(col, y0);
        if (y < 0) continue;
        const g = buf[at(y - 1, col)];
        if (g !== I.CRIMSON_NYLIUM && g !== I.WARPED_NYLIUM) continue;
        if (blocked(x, y, z)) continue;
        features.push({ type: 'huge_fungus', kind: g === I.CRIMSON_NYLIUM ? 'crimson' : 'warped', x, y, z, seed: s });
      } else if (b === SOUL) {
        if (k >= 3 || roll > 0.8) continue;
        const y = ceilFrom(col, y0);
        if (y < 0 || blocked(x, y, z)) continue;
        features.push({ type: 'basalt_pillar', x, y, z, seed: s });
      } else if (b === DELTAS) {
        const y = floorFrom(col, y0);
        if (y < 0 || blocked(x, y, z)) continue;
        if (k < 6) features.push({ type: 'delta', x, y: y - 1, z, seed: s });
        else features.push({ type: 'basalt_columns', x, y, z, seed: s, large: roll < 0.35 });
      }
    }
    return features;
  }

  _output(features) {
    const buf = this.buf;
    const sections = new Array(SECTION_COUNT).fill(null);
    for (let s = 4; s < 12; s++) {
      const off = s << 12;
      let any = false;
      for (let i = off, e = off + 4096; i < e; i++) if (buf[i] !== 0) { any = true; break; }
      if (any) sections[s] = buf.slice(off, off + 4096);
    }
    const heightmap = new Int16Array(256);
    for (let col = 0; col < 256; col++) {
      let y = 127;
      while (y > 0 && buf[at(y, col)] === 0) y--;
      heightmap[col] = y;
    }
    return { sections, biomes: Uint8Array.from(this.colBiome), heightmap, features };
  }
}

// vertical density profile: solid floor & ceiling, open caverns in between
function bias(y) {
  if (y <= 2) return 4;
  if (y < 8) return 4 - (y - 2) * 0.45;          // -> 1.3
  if (y < 24) return 1.3 - (y - 8) * 0.06;         // -> 0.34
  if (y < 34) return 0.34 - (y - 24) * 0.04;       // -> -0.06
  if (y < 84) return -0.06 - (y - 34) * 0.003;     // -> -0.21
  if (y < 104) return -0.21 + (y - 84) * 0.035;    // -> 0.49
  if (y < 118) return 0.49 + (y - 104) * 0.08;     // -> 1.61
  return 4;
}

// ------------------------------------------------------------------------------------------------
// Nether features (placeFeature). Footprints stay within 8 blocks of the origin.
const g = (a, x, y, z) => (a.getBlock(x, y, z) | 0) & 0xfff;
const isAir = (a, x, y, z) => (a.getBlock(x, y, z) | 0) === 0;
const REPLACEABLE_PLANT = new Uint8Array(4096);
for (const p of [0, I.CRIMSON_ROOTS, I.WARPED_ROOTS, I.CRIMSON_FUNGUS, I.WARPED_FUNGUS, I.FIRE, I.SOUL_FIRE]) REPLACEABLE_PLANT[p] = 1;

function glowstone(a, f) {
  const { x, y, z } = f;
  if (!isAir(a, x, y, z) || !ROCK[g(a, x, y + 1, z)]) return false;
  const r = new Rng(f.seed);
  a.setBlock(x, y, z, I.GLOWSTONE);
  for (let k = 0; k < 700; k++) {
    const px = x + r.int(8) - r.int(8), py = y - r.int(12), pz = z + r.int(8) - r.int(8);
    if (!isAir(a, px, py, pz)) continue;
    let n = 0;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (g(a, px + dx, py + dy, pz + dz) === I.GLOWSTONE) n++;
      if (n > 1) break;
    }
    if (n === 1) a.setBlock(px, py, pz, I.GLOWSTONE);
  }
  return true;
}

function hugeFungus(a, f) {
  const r = new Rng(f.seed);
  const crimson = f.kind === 'crimson';
  const stem = crimson ? I.CRIMSON_STEM : I.WARPED_STEM;
  const wart = crimson ? I.NETHER_WART_BLOCK : I.WARPED_WART_BLOCK;
  const { x, y, z } = f;
  const ground = g(a, x, y - 1, z);
  if (ground !== I.CRIMSON_NYLIUM && ground !== I.WARPED_NYLIUM) return false;
  let h = 4 + r.int(10);
  if (r.int(12) === 0) h *= 2;
  // shrink to the available head room
  let room = 0;
  while (room < h + 3 && REPLACEABLE_PLANT[g(a, x, y + room, z)]) room++;
  if (room < 6) return false;
  h = Math.min(h, room - 3);
  const thick = r.next() < 0.06;
  for (let i = 0; i < h; i++) {
    if (thick) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if ((dx === 0 || dz === 0 || i < h - 1) && REPLACEABLE_PLANT[g(a, x + dx, y + i, z + dz)]) a.setBlock(x + dx, y + i, z + dz, stem);
      }
    } else a.setBlock(x, y + i, z, stem);
  }
  // hat: skirt rings at the bottom, filled layers above, dangling drips below the rim
  const top = y + h;
  const hatH = Math.min(h, 3 + r.int(2) + (h > 8 ? 1 : 0));
  const put = (px, py, pz, v) => { if (REPLACEABLE_PLANT[g(a, px, py, pz)]) a.setBlock(px, py, pz, v); };
  for (let k = 0; k <= hatH; k++) {
    const py = top - hatH + k;
    const rad = k === hatH ? 1 : k === hatH - 1 ? 2 : (h > 8 ? 3 : 2);
    const skirt = k < hatH - 1;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
        const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && r.next() < 0.7) continue;
        if (skirt && !edge) continue;
        if (dx === 0 && dz === 0 && py < top) continue;
        const v = !edge && r.next() < 0.12 ? I.SHROOMLIGHT : (edge && skirt && r.next() < 0.08 ? I.SHROOMLIGHT : wart);
        put(x + dx, py, z + dz, v);
        if (skirt && k === 0 && edge && r.next() < 0.3) {
          const len = 1 + r.int(3);
          for (let d = 1; d <= len; d++) put(x + dx, py - d, z + dz, wart);
        }
      }
    }
  }
  return true;
}

function basaltPillar(a, f) {
  const { x, y, z } = f;
  if (!isAir(a, x, y, z)) return false;
  let bottom = y;
  while (bottom > 33 && isAir(a, x, bottom - 1, z) && y - bottom < 90) bottom--;
  if (y - bottom < 6 || !isAir(a, x, bottom, z)) return false;
  const r = new Rng(f.seed);
  for (let yy = bottom; yy <= y; yy++) a.setBlock(x, yy, z, I.BASALT);
  // thicken with partial neighbour columns hanging from the top and rising from the bottom
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (r.next() < 0.75) {
      const len = 2 + r.int(Math.max(1, (y - bottom) >> 1));
      for (let k = 0; k < len; k++) if (isAir(a, x + dx, y - k, z + dz)) a.setBlock(x + dx, y - k, z + dz, I.BASALT); else if (k > 0) break;
    }
    if (r.next() < 0.75) {
      const len = 2 + r.int(Math.max(1, (y - bottom) >> 1));
      for (let k = 0; k < len; k++) if (isAir(a, x + dx, bottom + k, z + dz)) a.setBlock(x + dx, bottom + k, z + dz, I.BASALT); else if (k > 0) break;
    }
  }
  return true;
}

function basaltColumns(a, f) {
  const r = new Rng(f.seed);
  const reach = f.large ? 2 + r.int(2) : 3;
  const baseH = f.large ? 5 + r.int(6) : 1 + r.int(4);
  let placed = false;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      if (dx * dx + dz * dz > reach * reach + 1 || r.next() < 0.35) continue;
      const px = f.x + dx, pz = f.z + dz;
      // find a floor near the origin height
      let py = -1;
      for (let dy = 4; dy >= -6; dy--) {
        const yy = f.y + dy;
        if (isAir(a, px, yy, pz) && IS_SOLID[g(a, px, yy - 1, pz)]) { py = yy; break; }
      }
      if (py < 0) continue;
      const hh = Math.max(1, baseH + r.int(5) - 2 - Math.floor(Math.sqrt(dx * dx + dz * dz)));
      for (let k = 0; k < hh; k++) {
        if (!isAir(a, px, py + k, pz)) break;
        a.setBlock(px, py + k, pz, I.BASALT);
      }
      placed = true;
    }
  }
  return placed;
}

// small lava / magma pool sunk into a floor, rimmed with magma and basalt
function delta(a, f) {
  const r = new Rng(f.seed);
  const rad = 2 + r.int(4);
  const { x, y, z } = f;
  let placed = false;
  for (let dx = -rad; dx <= rad; dx++) {
    for (let dz = -rad; dz <= rad; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > rad * rad) continue;
      const px = x + dx, pz = z + dz;
      if (!isAir(a, px, y + 1, pz)) continue;
      const here = g(a, px, y, pz);
      if (!IS_SOLID[here] || here === I.LAVA) continue;
      // the pool cell must be enclosed by solid blocks (sides and below) so it cannot spill
      let ok = IS_SOLID[g(a, px, y - 1, pz)] === 1;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = g(a, px + ox, y, pz + oz);
        if (!(IS_SOLID[c] || c === I.LAVA)) ok = false;
      }
      if (ok && d2 < (rad - 0.5) * (rad - 0.5)) { a.setBlock(px, y, pz, I.LAVA); placed = true; } else if (d2 >= (rad - 1) * (rad - 1)) {
        a.setBlock(px, y, pz, r.next() < 0.5 ? I.MAGMA_BLOCK : I.BASALT);
      }
    }
  }
  return placed;
}

