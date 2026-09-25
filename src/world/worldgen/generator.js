// BlockCraft world generator (Minecraft Java 1.18 "Caves & Cliffs" style).
//
// Pipeline per chunk column (all deterministic from seed + chunk coords):
//   1. 2D multi-noise climate per column (+ a 7x7 ring of 4-block "corners") -> height, 3D amplitude, biome
//   2. coarse 5x5x49 corner grid (4x8x4 cells): 3D terrain noise offset + cave channels
//   3. cell fill with trilinear interpolation (fast paths for all-solid / all-air cells)
//   4. bedrock, 2D spaghetti corridors, surface rules, worm/ravine carvers, ores & stone blobs
//   5. in-column decoration (plants, snow, ice, seagrass...) and a list of multi-chunk features
import { MIN_Y, MAX_Y, SEA_LEVEL, SECTION_COUNT } from '../../constants.js';
import { BIOME, BiomeById } from '../../registry/biomes.js';
import { IS_SOLID } from '../../registry/blocks.js';
import { Climate, makeSample } from './climate.js';
import { CaveNoise, runCarvers } from './caves.js';
import { placeVeins } from './ores.js';
import { applySurface, decorate } from './surface.js';
import { placeFeature as placeFeatureImpl } from './features.js';
import { BINFO, pickTree } from './biomeinfo.js';
import { Fractal, Rng, hash32, hashf } from './noise.js';
import * as I from './ids.js';

const WH = MAX_Y - MIN_Y;         // 384
const NY = WH / 8 + 1;            // 49 corner rows (8-block cells)
const NC = 5 * 5 * NY;            // corners per chunk
const SEA = SEA_LEVEL;
const TERRAIN_SD = 0.181;         // std-dev of 3-octave 3D fractal
const TOP_SLIDE = 272;            // density fades to air above this y (keeps peaks below the build limit)
const { AIR, WATER, STONE, DEEPSLATE, BEDROCK } = I;

export class WorldGenerator {
  constructor(seed, options = {}) {
    this.seed = seed | 0;
    this.type = options.type ?? 'default';
    this.flat = this.type === 'flat';
    this.climate = new Climate(this.seed, this.type);
    this.caves = new CaveNoise(this.seed);
    this.sample = makeSample();
    const h = (k) => hash32(this.seed, k, 0x5eed, 9);
    this.terrain3d = new Fractal(h(1), 3, 1 / 110, { yFreq: 1 / 105, persistence: 0.45 });
    this.surfN = new Fractal(h(2), 2, 1 / 11);
    this.surfN2 = new Fractal(h(3), 2, 1 / 42);
    this.flowerN = new Fractal(h(4), 2, 1 / 34);
    this.flowerT = new Fractal(h(5), 1, 1 / 60);
    this.grassN = new Fractal(h(6), 2, 1 / 20);
    this.dripN = new Fractal(h(7), 2, 1 / 150);
    this.lushN = new Fractal(h(8), 2, 1 / 150);

    // working buffers (reused between calls)
    this.buf = new Uint16Array(WH * 256);
    this.colH = new Float32Array(256);
    this.colAmp = new Float32Array(256);
    this.colBiome = new Uint8Array(256);
    this.colBank = new Uint8Array(256);
    this.colTop = new Int16Array(256);
    this.colSlope = new Uint8Array(256);
    this.protY = new Int16Array(256);
    this.surfTop = new Int16Array(256);
    this.sn = new Float32Array(256);
    this.sn2 = new Float32Array(256);
    this.fn = new Float32Array(256);
    this.ft = new Float32Array(256);
    this.gn = new Float32Array(256);
    this.drip = new Float32Array(256);
    this.lush = new Float32Array(256);
    this.cH = new Float32Array(49);   // 7x7 ring corners
    this.cA = new Float32Array(49);
    this.cProt = new Float32Array(25);
    this.cellMin = new Float32Array(16);
    this.cellMax = new Float32Array(16);
    this.N3 = new Float32Array(NC);
    this.CV = new Float32Array(NC);
    this.SA = new Float32Array(NC);
    this.SB = new Float32Array(NC);
    this.SR = new Float32Array(NC);
    this.NA = new Float32Array(NC);
    this.NB = new Float32Array(NC);
    this.NR = new Float32Array(NC);
    this.corr = new Int32Array(8);
    this.used = new Uint8Array(256);
    this._spawn = null;
  }

  // ------------------------------------------------------------------------------------------
  getBiomeAt(x, z) {
    if (this.flat) return BIOME.plains;
    return this.climate.sample(Math.floor(x), Math.floor(z), this.sample).biome;
  }

  // Estimated surface height (2D, ignores 3D noise/caves) - cheap, used for spawn search/previews.
  getHeightEstimate(x, z) {
    if (this.flat) return -61;
    return this.climate.sample(Math.floor(x), Math.floor(z), this.sample).H;
  }

  placeFeature(access, feature) {
    if (this.flat) return false;
    return placeFeatureImpl(access, feature);
  }

  getSpawnPoint() {
    if (this._spawn) return { ...this._spawn };
    if (this.flat) { this._spawn = { x: 0, y: -60, z: 0 }; return { ...this._spawn }; }
    const o = this.sample;
    let best = null, fallback = null;
    // spiral search on a 16-block lattice: prefer temperate dry land, accept any dry land
    for (let ring = 0; ring < 96 && !best; ring++) {
      for (let i = -ring; i <= ring && !best; i++) {
        for (let j = -ring; j <= ring && !best; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const x = i * 16 + 8, z = j * 16 + 8;
          this.climate.sample(x, z, o);
          const info = BINFO[o.biome];
          if (!(o.H >= SEA + 2 && o.H < 105 && !info.water && o.biome !== BIOME.stony_shore)) continue;
          if (!fallback) fallback = { x, z };
          if (o.ti >= 1 && o.ti <= 3 && o.biome !== BIOME.swamp) best = { x, z };
        }
      }
    }
    if (!best) best = fallback;
    if (!best) best = { x: 8, z: 8 };
    // generate that column and find a dry standing spot
    const cx = best.x >> 4, cz = best.z >> 4;
    const col = this.generateColumn(cx, cz);
    // keep clear of planned tree trunks (features are applied after generation)
    const trunk = new Uint8Array(256);
    for (const f of col.features) {
      if (f.type !== 'tree') continue;
      for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
        const lx = f.x - cx * 16 + dx, lz = f.z - cz * 16 + dz;
        if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) trunk[lz * 16 + lx] = 1;
      }
    }
    let pick = null;
    for (let r = 0; r < 8 && !pick; r++) {
      for (let dz = -r; dz <= r && !pick; dz++) for (let dx = -r; dx <= r && !pick; dx++) {
        const lx = 8 + dx, lz = 8 + dz;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || trunk[lz * 16 + lx]) continue;
        for (let y = col.heightmap[lz * 16 + lx]; y > MIN_Y; y--) {
          const s = col.sections[(y - MIN_Y) >> 4];
          const v = s ? s[((y - MIN_Y) & 15) * 256 + lz * 16 + lx] & 0xfff : 0;
          if (v === 0 || !IS_SOLID[v] || v === I.CACTUS) {
            if (v === WATER || v === I.LAVA) break;
            continue;
          }
          if (v === I.ICE || v === I.OAK_LEAVES) break;
          pick = { x: cx * 16 + lx, y: y + 1, z: cz * 16 + lz };
          break;
        }
      }
    }
    this._spawn = pick ?? { x: best.x, y: Math.ceil(this.getHeightEstimate(best.x, best.z)) + 1, z: best.z };
    return { ...this._spawn };
  }

  // ------------------------------------------------------------------------------------------
  generateColumn(cx, cz) {
    if (this.flat) return this._flatColumn(cx, cz);
    const X0 = cx << 4, Z0 = cz << 4;
    const buf = this.buf;
    buf.fill(0);
    this.curX0 = X0; this.curZ0 = Z0;
    this._columns2D(X0, Z0);
    this._corners3D(X0, Z0);
    this._fill(X0, Z0);
    this._bedrockAndCorridors(X0, Z0);
    this._computeTop();
    applySurface(this);
    runCarvers({ cx, cz, buf, protY: this.protY, caves: this.caves, seed: this.seed });
    let topMax = MIN_Y;
    for (let i = 0; i < 256; i++) if (this.colTop[i] > topMax) topMax = this.colTop[i];
    placeVeins({
      cx, cz, buf, seed: this.seed, topMax,
      biomeNameAt: (x, z) => {
        const lx = x - X0, lz = z - Z0;
        if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) return BiomeById[this.colBiome[lz * 16 + lx]].name;
        return BiomeById[this.getBiomeAt(x, z)].name;
      },
    });
    this.X0 = X0; this.Z0 = Z0;
    decorate(this);
    const features = this._planFeatures(cx, cz);
    return this._output(features);
  }

  // 2D parameters per column + ring of corners
  _columns2D(X0, Z0) {
    const cl = this.climate, o = this.sample;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = (lz << 4) | lx;
        const x = X0 + lx, z = Z0 + lz;
        cl.sample(x, z, o);
        this.colH[col] = o.H;
        this.colAmp[col] = o.amp;
        this.colBiome[col] = o.biome;
        this.colBank[col] = o.riverScale > 0.5 && o.river < 0.11 ? 1 : 0;
        this.sn[col] = this.surfN.sample2(x, z) / 0.228;
        this.sn2[col] = this.surfN2.sample2(x, z) / 0.228;
        this.fn[col] = this.flowerN.sample2(x, z) / 0.228 * 0.5;
        this.ft[col] = Math.max(-1, Math.min(1, this.flowerT.sample2(x, z) / 0.309 * 0.6));
        this.gn[col] = Math.max(0, Math.min(1, this.grassN.sample2(x, z) / 0.228 * 0.3 + 0.5));
        this.drip[col] = this.dripN.sample2(x, z) / 0.228 * 0.3;
        this.lush[col] = this.lushN.sample2(x, z) / 0.228 * 0.3;
      }
    }
    for (let gz = -1; gz <= 5; gz++) {
      for (let gx = -1; gx <= 5; gx++) {
        const k = (gz + 1) * 7 + gx + 1;
        if (gx >= 0 && gx < 4 && gz >= 0 && gz < 4) {
          const col = (gz * 4) * 16 + gx * 4;
          this.cH[k] = this.colH[col]; this.cA[k] = this.colAmp[col];
        } else {
          cl.sample(X0 + gx * 4, Z0 + gz * 4, o);
          this.cH[k] = o.H; this.cA[k] = o.amp;
        }
      }
    }
    // corner cave protection near water (3x3 neighbourhood minimum)
    for (let gz = 0; gz <= 4; gz++) {
      for (let gx = 0; gx <= 4; gx++) {
        let m = 1e9;
        for (let dz = 0; dz <= 2; dz++) for (let dx = 0; dx <= 2; dx++) {
          const k = (gz + dz) * 7 + gx + dx;
          const v = this.cH[k] - this.cA[k];
          if (v < m) m = v;
        }
        this.cProt[gx * 5 + gz] = m < SEA + 1.5 ? Math.floor(m) - 8 : 1e9;
      }
    }
    // per-column protection: min over 4x4 surrounding corners and itself
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = (lz << 4) | lx;
        let m = this.colH[col] - this.colAmp[col];
        const gx0 = lx >> 2, gz0 = lz >> 2;
        for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
          const k = (gz0 + dz) * 7 + gx0 + dx;
          const v = this.cH[k] - this.cA[k];
          if (v < m) m = v;
        }
        this.protY[col] = m < SEA + 1.5 ? Math.floor(m) - 5 : 32767;
      }
    }
    // cell height ranges
    for (let ci = 0; ci < 4; ci++) {
      for (let cj = 0; cj < 4; cj++) {
        let mn = 1e9, mx = -1e9;
        for (let lz = cj * 4; lz < cj * 4 + 4; lz++) for (let lx = ci * 4; lx < ci * 4 + 4; lx++) {
          const v = this.colH[(lz << 4) | lx];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        this.cellMin[ci * 4 + cj] = mn; this.cellMax[ci * 4 + cj] = mx;
      }
    }
  }

  // 3D values at the coarse 5x5x49 grid
  _corners3D(X0, Z0) {
    const { N3, CV, SA, SB, SR, NA, NB, NR, caves } = this;
    const t3 = this.terrain3d;
    const kN = 1 / (TERRAIN_SD * 2.2);
    for (let gx = 0; gx <= 4; gx++) {
      for (let gz = 0; gz <= 4; gz++) {
        const ci = gx * 5 + gz;
        const wx = X0 + gx * 4, wz = Z0 + gz * 4;
        let hmin = 1e9, hmax = -1e9;
        for (let a = gx - 1; a <= gx; a++) for (let b = gz - 1; b <= gz; b++) {
          if (a < 0 || a > 3 || b < 0 || b > 3) continue;
          if (this.cellMin[a * 4 + b] < hmin) hmin = this.cellMin[a * 4 + b];
          if (this.cellMax[a * 4 + b] > hmax) hmax = this.cellMax[a * 4 + b];
        }
        const k7 = (gz + 1) * 7 + gx + 1;
        const Hc = this.cH[k7], amp = this.cA[k7];
        const lo = hmin - amp - 2, hi = hmax + amp + 2;
        const prot = this.cProt[ci];
        for (let gy = 0; gy < NY; gy++) {
          const y = MIN_Y + gy * 8;
          const k = ci * NY + gy;
          const needCaves = y <= hi && y <= 300;
          // terrain offset: pure function of the corner position whenever it can matter
          let off = 0;
          if ((y >= lo && y <= hi) || (needCaves && y > Hc - amp - 40)) {
            let n = t3.sample3(wx, y, wz) * kN;
            if (n > 1) n = 1; else if (n < -1) n = -1;
            off = n * amp;
          }
          N3[k] = y < lo || y > hi ? 0 : off;
          if (!needCaves) { CV[k] = 1; SR[k] = -1; NR[k] = -1; SA[k] = 9; SB[k] = 9; NA[k] = 9; NB[k] = 9; } else caves.corner(wx, y, wz, Hc + off, prot, k, CV, SA, SB, SR, NA, NB, NR);
        }
      }
    }
  }

  _fill(X0, Z0) {
    const { buf, N3, CV, SA, SB, SR, NA, NB, NR, colH, caves } = this;
    const seed = this.seed;
    for (let ci = 0; ci < 4; ci++) {
      for (let cj = 0; cj < 4; cj++) {
        const b00 = (ci * 5 + cj) * NY, b10 = ((ci + 1) * 5 + cj) * NY;
        const b01 = (ci * 5 + cj + 1) * NY, b11 = ((ci + 1) * 5 + cj + 1) * NY;
        const hmin = this.cellMin[ci * 4 + cj], hmax = this.cellMax[ci * 4 + cj];
        for (let cy = 0; cy < NY - 1; cy++) {
          const y0 = MIN_Y + cy * 8;
          const i000 = b00 + cy, i100 = b10 + cy, i010 = b01 + cy, i110 = b11 + cy;
          const n0 = N3[i000], n1 = N3[i100], n2 = N3[i010], n3 = N3[i110];
          const n4 = N3[i000 + 1], n5 = N3[i100 + 1], n6 = N3[i010 + 1], n7 = N3[i110 + 1];
          const nmax = Math.max(n0, n1, n2, n3, n4, n5, n6, n7);
          if (hmax + nmax < y0) { // all terrain-air
            if (y0 <= SEA) this._fillWaterCell(ci, cj, y0);
            continue;
          }
          const nmin = Math.min(n0, n1, n2, n3, n4, n5, n6, n7);
          const allSolid = hmin + nmin > y0 + 8 && y0 + 8 <= TOP_SLIDE;
          // cave checks
          const cvMin = Math.min(CV[i000], CV[i100], CV[i010], CV[i110], CV[i000 + 1], CV[i100 + 1], CV[i010 + 1], CV[i110 + 1]);
          const spag = tubePossible(SA, SB, SR, i000, i100, i010, i110);
          const nood = tubePossible(NA, NB, NR, i000, i100, i010, i110);
          const anyCave = cvMin < 0 || spag || nood;
          if (allSolid && !anyCave) { this._fillStoneCell(ci, cj, y0); continue; }
          for (let lx = 0; lx < 4; lx++) {
            const fx = lx * 0.25;
            for (let lz = 0; lz < 4; lz++) {
              const fz = lz * 0.25;
              const col = ((cj * 4 + lz) << 4) | (ci * 4 + lx);
              const H = colH[col];
              const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
              const nb = n0 * w00 + n1 * w10 + n2 * w01 + n3 * w11;
              const nt = n4 * w00 + n5 * w10 + n6 * w01 + n7 * w11;
              let cvb = 0, cvt = 0, sab = 0, sat = 0, sbb = 0, sbt = 0, srb = 0, srt = 0;
              let nab = 0, nat = 0, nbb = 0, nbt = 0, nrb = 0, nrt = 0;
              if (anyCave) {
                cvb = CV[i000] * w00 + CV[i100] * w10 + CV[i010] * w01 + CV[i110] * w11;
                cvt = CV[i000 + 1] * w00 + CV[i100 + 1] * w10 + CV[i010 + 1] * w01 + CV[i110 + 1] * w11;
                if (spag) {
                  sab = SA[i000] * w00 + SA[i100] * w10 + SA[i010] * w01 + SA[i110] * w11;
                  sat = SA[i000 + 1] * w00 + SA[i100 + 1] * w10 + SA[i010 + 1] * w01 + SA[i110 + 1] * w11;
                  sbb = SB[i000] * w00 + SB[i100] * w10 + SB[i010] * w01 + SB[i110] * w11;
                  sbt = SB[i000 + 1] * w00 + SB[i100 + 1] * w10 + SB[i010 + 1] * w01 + SB[i110 + 1] * w11;
                  srb = SR[i000] * w00 + SR[i100] * w10 + SR[i010] * w01 + SR[i110] * w11;
                  srt = SR[i000 + 1] * w00 + SR[i100 + 1] * w10 + SR[i010 + 1] * w01 + SR[i110 + 1] * w11;
                }
                if (nood) {
                  nab = NA[i000] * w00 + NA[i100] * w10 + NA[i010] * w01 + NA[i110] * w11;
                  nat = NA[i000 + 1] * w00 + NA[i100 + 1] * w10 + NA[i010 + 1] * w01 + NA[i110 + 1] * w11;
                  nbb = NB[i000] * w00 + NB[i100] * w10 + NB[i010] * w01 + NB[i110] * w11;
                  nbt = NB[i000 + 1] * w00 + NB[i100 + 1] * w10 + NB[i010 + 1] * w01 + NB[i110 + 1] * w11;
                  nrb = NR[i000] * w00 + NR[i100] * w10 + NR[i010] * w01 + NR[i110] * w11;
                  nrt = NR[i000 + 1] * w00 + NR[i100 + 1] * w10 + NR[i010 + 1] * w01 + NR[i110 + 1] * w11;
                }
              }
              for (let ly = 0; ly < 8; ly++) {
                const fy = ly * 0.125;
                const y = y0 + ly;
                const idx = ((y - MIN_Y) << 8) | col;
                let d = H - y + nb + (nt - nb) * fy;
                if (y > TOP_SLIDE) d -= (y - TOP_SLIDE) * 1.2;
                if (d <= 0) { if (y <= SEA) buf[idx] = WATER; continue; }
                if (anyCave) {
                  let cave = cvb + (cvt - cvb) * fy < 0;
                  if (!cave && spag) {
                    const r = srb + (srt - srb) * fy;
                    if (r > 0) {
                      const a = sab + (sat - sab) * fy, b = sbb + (sbt - sbb) * fy;
                      cave = a < r && a > -r && b < r && b > -r;
                    }
                  }
                  if (!cave && nood) {
                    const r = nrb + (nrt - nrb) * fy;
                    if (r > 0) {
                      const a = nab + (nat - nab) * fy, b = nbb + (nbt - nbb) * fy;
                      cave = a < r && a > -r && b < r && b > -r;
                    }
                  }
                  if (cave) {
                    const f = caves.fluidAt(X0 + ci * 4 + lx, y, Z0 + cj * 4 + lz);
                    if (f >= 0) { buf[idx] = f; continue; }
                  }
                }
                buf[idx] = y >= 8 ? STONE : y < 0 ? DEEPSLATE
                  : (hashf(X0 + ci * 4 + lx, y, Z0 + cj * 4 + lz, seed) * 8 < 8 - y ? DEEPSLATE : STONE);
              }
            }
          }
        }
      }
    }
  }

  _fillWaterCell(ci, cj, y0) {
    const buf = this.buf;
    const yEnd = Math.min(y0 + 7, SEA);
    for (let y = y0; y <= yEnd; y++) {
      const base = (y - MIN_Y) << 8;
      for (let lz = cj * 4; lz < cj * 4 + 4; lz++) {
        const row = base | (lz << 4);
        for (let lx = ci * 4; lx < ci * 4 + 4; lx++) buf[row | lx] = WATER;
      }
    }
  }

  _fillStoneCell(ci, cj, y0) {
    const buf = this.buf, seed = this.seed;
    const X0 = this.curX0, Z0 = this.curZ0;
    for (let y = y0; y < y0 + 8; y++) {
      const base = (y - MIN_Y) << 8;
      if (y >= 8 || y < 0) {
        const v = y >= 8 ? STONE : DEEPSLATE;
        for (let lz = cj * 4; lz < cj * 4 + 4; lz++) {
          const row = base | (lz << 4);
          for (let lx = ci * 4; lx < ci * 4 + 4; lx++) buf[row | lx] = v;
        }
      } else {
        for (let lz = cj * 4; lz < cj * 4 + 4; lz++) {
          const row = base | (lz << 4);
          for (let lx = ci * 4; lx < ci * 4 + 4; lx++) {
            buf[row | lx] = hashf(X0 + lx, y, Z0 + lz, seed) * 8 < 8 - y ? DEEPSLATE : STONE;
          }
        }
      }
    }
  }

  _bedrockAndCorridors(X0, Z0) {
    const buf = this.buf, seed = this.seed, caves = this.caves, corr = this.corr;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = (lz << 4) | lx;
        const x = X0 + lx, z = Z0 + lz;
        buf[col] = BEDROCK;
        for (let y = MIN_Y + 1; y <= MIN_Y + 4; y++) {
          if (hashf(x, y, z, seed ^ 0xbed) < (MIN_Y + 5 - y) / 5) buf[((y - MIN_Y) << 8) | col] = BEDROCK;
        }
        const n = caves.corridors(x, z, corr);
        const py = this.protY[col];
        for (let k = 0; k < n; k += 2) {
          const lo = Math.max(MIN_Y + 5, corr[k]), hi = Math.min(corr[k + 1], py - 1, 300);
          for (let y = lo; y <= hi; y++) {
            const idx = ((y - MIN_Y) << 8) | col;
            const v = buf[idx];
            if (v !== STONE && v !== DEEPSLATE) continue;
            const f = caves.fluidAt(x, y, z);
            if (f >= 0) buf[idx] = f;
          }
        }
      }
    }
  }

  _computeTop() {
    const buf = this.buf;
    for (let col = 0; col < 256; col++) {
      let y = Math.min(MAX_Y - 1, Math.ceil(this.colH[col] + this.colAmp[col]) + 3);
      while (y > MIN_Y) {
        const v = buf[((y - MIN_Y) << 8) | col];
        if (v !== AIR && v !== WATER && v !== I.LAVA) break;
        y--;
      }
      this.colTop[col] = y;
    }
    const t = this.colTop;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = (lz << 4) | lx;
        const xa = lx > 0 ? t[col - 1] : t[col], xb = lx < 15 ? t[col + 1] : t[col];
        const za = lz > 0 ? t[col - 16] : t[col], zb = lz < 15 ? t[col + 16] : t[col];
        const sx = Math.abs(xb - xa) * (lx > 0 && lx < 15 ? 1 : 2);
        const sz = Math.abs(zb - za) * (lz > 0 && lz < 15 ? 1 : 2);
        this.colSlope[col] = Math.min(255, Math.max(sx, sz));
      }
    }
  }

  _planFeatures(cx, cz) {
    const features = [];
    const { buf, colBiome, colTop, used } = this;
    const X0 = cx << 4, Z0 = cz << 4;
    const seed = this.seed;
    used.fill(0);
    // ---- trees ----
    const r = new Rng(hash32(seed, cx, cz, 0x7ee5));
    const K = 28;
    for (let k = 0; k < K; k++) {
      const lx = r.int(16), lz = r.int(16);
      const acc = r.next(), kr = r.next(), s = r.int(0x7fffffff);
      const col = (lz << 4) | lx;
      const info = BINFO[colBiome[col]];
      if (acc >= info.trees / K) continue;
      const kind = pickTree(info, kr);
      const big = kind === 'dark_oak' || kind === 'mega_jungle';
      if (big && (lx > 14 || lz > 14)) continue;
      if (used[col]) continue;
      const gy = colTop[col];
      const g = buf[((gy - MIN_Y) << 8) | col] & 0xfff;
      if (!(g === I.GRASS_BLOCK || g === I.DIRT || g === I.PODZOL || g === I.COARSE_DIRT)) continue;
      if (big && (colTop[col + 1] !== gy || colTop[col + 16] !== gy || colTop[col + 17] !== gy)) continue;
      const above = buf[((gy + 1 - MIN_Y) << 8) | col];
      if (above === WATER && kind !== 'swamp_oak') continue;
      features.push({ type: 'tree', kind, x: X0 + lx, y: gy + 1, z: Z0 + lz, seed: s, snowy: gy + 1 >= info.snowLine });
      const rad = big ? 2 : 1;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const ax = lx + dx, az = lz + dz;
        if (ax >= 0 && ax < 16 && az >= 0 && az < 16) used[(az << 4) | ax] = 1;
      }
    }
    // ---- lakes ----
    const rl = new Rng(hash32(seed, cx, cz, 0x1a4e));
    const roll = rl.next(), lx = rl.int(16), lz = rl.int(16), ls = rl.int(0x7fffffff);
    const lcol = (lz << 4) | lx;
    const linfo = BINFO[colBiome[lcol]];
    const surfaceOk = !linfo.water && linfo.surface !== 2 && colTop[lcol] > SEA && colTop[lcol] < 200;
    if (roll < 1 / 48 && surfaceOk) {
      features.push({ type: 'lake', fluid: 'water', x: X0 + lx, y: colTop[lcol], z: Z0 + lz, seed: ls, frozen: linfo.freezes });
    } else if (roll > 1 - 1 / 280 && surfaceOk) {
      features.push({ type: 'lake', fluid: 'lava', x: X0 + lx, y: colTop[lcol], z: Z0 + lz, seed: ls });
    }
    const ul = rl.next(), ux = rl.int(16), uz = rl.int(16), us = rl.int(0x7fffffff), uyr = rl.next();
    if (ul < 1 / 9) {
      const top = colTop[(uz << 4) | ux] - 14;
      const y = Math.floor(-54 + uyr * (Math.min(top, 48) + 54));
      if (y > -54) features.push({ type: 'lake', fluid: 'lava', x: X0 + ux, y, z: Z0 + uz, seed: us });
    }
    // ---- dungeons ----
    // Find cave floors, then try room centres 3-4 blocks into the rock around them, running the
    // same checks as placeFeature (MC MonsterRoomFeature) on this chunk's blocks.
    const rd = new Rng(hash32(seed, cx, cz, 0xd06e));
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const solidAt = (lx, y, lz) => IS_SOLID[buf[((y - MIN_Y) << 8) | (lz << 4) | lx] & 0xfff] === 1;
    const airAt = (lx, y, lz) => buf[((y - MIN_Y) << 8) | (lz << 4) | lx] === AIR;
    let placed = 0;
    for (let a = 0; a < 10 && placed < 2; a++) {
      const dx = 1 + rd.int(14), dz = 1 + rd.int(14), ds = rd.int(0x7fffffff), dyr = rd.next(), d0 = rd.int(4);
      const col = (dz << 4) | dx;
      const top = Math.min(colTop[col] - 10, 110);
      if (top < -50) continue;
      let y = Math.floor(-57 + dyr * (top + 57));
      let floorY = -999;
      for (let k = 0; k < 24 && y > -58; k++, y--) {
        if (airAt(dx, y, dz) && solidAt(dx, y - 1, dz)) { floorY = y; break; }
      }
      if (floorY === -999) continue;
      const rr = new Rng(ds);
      const xr = rr.int(2) + 2, zr = rr.int(2) + 2;
      for (let t = 0; t < 8; t++) {
        const dir = DIRS[(d0 + (t >> 1)) & 3], off = 3 + (t & 1);
        const rx = dx + dir[0] * (xr + off - 2), rz = dz + dir[1] * (zr + off - 2);
        if (rx - xr - 1 < 0 || rx + xr + 1 > 15 || rz - zr - 1 < 0 || rz + zr + 1 > 15) continue;
        let ok = true, open = 0;
        for (let bx = -xr - 1; bx <= xr + 1 && ok; bx++) for (let bz = -zr - 1; bz <= zr + 1 && ok; bz++) {
          if (!solidAt(rx + bx, floorY - 1, rz + bz) || !solidAt(rx + bx, floorY + 4, rz + bz)) ok = false;
          else if ((bx === -xr - 1 || bx === xr + 1 || bz === -zr - 1 || bz === zr + 1) &&
            airAt(rx + bx, floorY, rz + bz) && airAt(rx + bx, floorY + 1, rz + bz)) open++;
        }
        if (ok && open >= 1 && open <= 5) {
          features.push({ type: 'dungeon', x: X0 + rx, y: floorY, z: Z0 + rz, seed: ds });
          placed++;
          break;
        }
      }
    }
    return features;
  }

  _output(features) {
    const buf = this.buf;
    const sections = new Array(SECTION_COUNT);
    for (let s = 0; s < SECTION_COUNT; s++) {
      const off = s << 12;
      let any = false;
      for (let i = off, e = off + 4096; i < e; i++) if (buf[i] !== 0) { any = true; break; }
      sections[s] = any ? buf.slice(off, off + 4096) : null;
    }
    const heightmap = new Int16Array(256);
    for (let col = 0; col < 256; col++) {
      let y = Math.min(MAX_Y - 1, this.surfTop[col] + 4);
      while (y > MIN_Y && buf[((y - MIN_Y) << 8) | col] === 0) y--;
      heightmap[col] = y;
    }
    return { sections, biomes: Uint8Array.from(this.colBiome), heightmap, features };
  }

  _flatColumn() {
    const sections = new Array(SECTION_COUNT).fill(null);
    const s = new Uint16Array(4096);
    for (let i = 0; i < 256; i++) {
      s[i] = BEDROCK; s[256 + i] = I.DIRT; s[512 + i] = I.DIRT; s[768 + i] = I.GRASS_BLOCK;
    }
    sections[0] = s;
    return {
      sections,
      biomes: new Uint8Array(256).fill(BIOME.plains),
      heightmap: new Int16Array(256).fill(MIN_Y + 3),
      features: [],
    };
  }
}

// Can a "tube" (|a|<r && |b|<r) pass through this cell? Conservative test on the 8 corners.
function tubePossible(A, Bv, R, i000, i100, i010, i110) {
  const rmax = Math.max(R[i000], R[i100], R[i010], R[i110], R[i000 + 1], R[i100 + 1], R[i010 + 1], R[i110 + 1]);
  if (rmax <= 0) return false;
  let lo = Math.min(A[i000], A[i100], A[i010], A[i110], A[i000 + 1], A[i100 + 1], A[i010 + 1], A[i110 + 1]);
  let hi = Math.max(A[i000], A[i100], A[i010], A[i110], A[i000 + 1], A[i100 + 1], A[i010 + 1], A[i110 + 1]);
  if (lo > rmax || hi < -rmax) return false;
  lo = Math.min(Bv[i000], Bv[i100], Bv[i010], Bv[i110], Bv[i000 + 1], Bv[i100 + 1], Bv[i010 + 1], Bv[i110 + 1]);
  hi = Math.max(Bv[i000], Bv[i100], Bv[i010], Bv[i110], Bv[i000 + 1], Bv[i100 + 1], Bv[i010 + 1], Bv[i110 + 1]);
  if (lo > rmax || hi < -rmax) return false;
  return true;
}

export default WorldGenerator;
