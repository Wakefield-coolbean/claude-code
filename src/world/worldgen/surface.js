// Surface rules (grass/dirt/sand/snow/stone by biome & slope) and in-column decoration
// (plants, snow layers, ice, seagrass, sugar cane, cacti, cave dripstone/moss patches).
import { MIN_Y, SEA_LEVEL } from '../../constants.js';
import { IS_SOLID } from '../../registry/blocks.js';
import { hash32, hashf, Rng } from './noise.js';
import * as I from './ids.js';
import {
  BINFO, S_DESERT, S_BEACH, S_STONY_SHORE, S_BADLANDS, S_SNOWY_SLOPES, S_JAGGED, S_FROZEN_PEAKS,
  S_STONY_PEAKS, S_WINDSWEPT, S_TAIGA, S_OCEAN_WARM, S_OCEAN, S_OCEAN_COLD, S_RIVER, S_SWAMP, S_GROVE, S_SAVANNA,
} from './biomeinfo.js';

const { AIR, WATER, LAVA, STONE, DEEPSLATE } = I;
const at = (y, col) => ((y - MIN_Y) << 8) | col;

// ---------------------------------------------------------------------------------------------
// Surface rules. ctx: buf, colBiome, colH, colAmp, colTop, colSlope, colBank, sn, sn2
export function applySurface(ctx) {
  const { buf, colBiome, colH, colAmp, colTop, colSlope, colBank, sn, sn2 } = ctx;
  for (let col = 0; col < 256; col++) {
    const top = colTop[col];
    if (top <= MIN_Y) continue;
    const info = BINFO[colBiome[col]];
    const cat = info.surface;
    const n1 = sn[col], n2 = sn2[col];
    const slope = colSlope[col];
    const bank = colBank[col];
    const low = Math.max(MIN_Y + 6, Math.min(top - 4, Math.floor(colH[col] - colAmp[col]) - 14));
    let depth = 0;
    let water = buf[at(top + 1, col)] === WATER;
    const dirtDepth = 3 + (n1 > 0 ? 1 : 0) + (n1 > 0.6 ? 1 : 0);
    for (let y = top; y >= low; y--) {
      const i = at(y, col);
      const v = buf[i];
      if (v === AIR || v === WATER || v === LAVA) { depth = 0; water = v === WATER; continue; }
      const d = depth++;
      if (v !== STONE && v !== DEEPSLATE) continue;
      if (d > 14) continue;
      let b = 0;
      if (water) b = underwater(cat, d, y, n1, n2, info);
      else b = land(cat, d, y, n1, n2, slope, bank, dirtDepth, info);
      if (b) buf[i] = b;
    }
  }
}

function underwater(cat, d, y, n1, n2, info) {
  let mat;
  switch (cat) {
    case S_OCEAN_WARM: case S_DESERT: case S_BEACH: mat = I.SAND; break;
    case S_OCEAN: mat = n1 > 0.35 ? I.GRAVEL : (n2 > 0.55 && y > 44 ? I.CLAY : I.SAND); break;
    case S_OCEAN_COLD: mat = n1 > -0.35 ? I.GRAVEL : I.SAND; break;
    case S_RIVER: mat = n2 > 0.5 ? I.CLAY : n1 > 0.3 ? I.GRAVEL : I.SAND; break;
    case S_SWAMP: mat = n1 > 0.25 ? I.CLAY : I.DIRT; break;
    case S_STONY_SHORE: case S_STONY_PEAKS: case S_JAGGED: case S_FROZEN_PEAKS: case S_SNOWY_SLOPES: case S_WINDSWEPT:
      mat = I.GRAVEL; break;
    case S_BADLANDS: mat = I.RED_SAND; break;
    default: mat = y >= SEA_LEVEL - 3 ? I.SAND : (n1 > 0.1 ? I.GRAVEL : n2 > 0.4 ? I.CLAY : I.DIRT);
  }
  if (d < 3) return mat;
  if (mat === I.SAND && d < 5) return I.SANDSTONE;
  return 0;
}

function land(cat, d, y, n1, n2, slope, bank, dirtDepth, info) {
  switch (cat) {
    case S_DESERT:
      return d < 4 ? I.SAND : d < 8 ? I.SANDSTONE : 0;
    case S_BEACH:
      return d < 3 ? I.SAND : d < 5 ? I.SANDSTONE : 0;
    case S_STONY_SHORE:
      return d === 0 && n1 > 0.45 ? I.GRAVEL : 0;
    case S_BADLANDS:
      if (d === 0 && slope < 4 && y < 120) return I.RED_SAND;
      return d < 16 ? I.TERRACOTTA : 0;
    case S_SNOWY_SLOPES:
      if (slope >= 4) return 0;
      return d === 0 ? I.SNOW_BLOCK : d < 3 ? (n1 > 0 ? I.SNOW_BLOCK : I.DIRT) : 0;
    case S_JAGGED:
      if (slope >= 4) return 0;
      return d < 2 ? I.SNOW_BLOCK : 0;
    case S_FROZEN_PEAKS:
      if (slope >= 4) return d === 0 && n1 > 0.9 ? I.PACKED_ICE : 0;
      if (d === 0) return n1 > 1.25 ? I.PACKED_ICE : I.SNOW_BLOCK;
      return d < 2 ? I.SNOW_BLOCK : 0;
    case S_STONY_PEAKS:
      if (d === 0 && n2 > 1.1) return I.CALCITE;
      if (d === 1 && n2 > 1.25) return I.CALCITE;
      return 0;
    case S_WINDSWEPT:
      if (slope >= 5 || n1 > 0.42) return 0;
      if (n1 < -0.55 && d === 0) return I.GRAVEL;
      break;
    case S_GROVE:
      if (slope >= 5) return 0;
      break;
    case S_OCEAN: case S_OCEAN_WARM: case S_OCEAN_COLD:
      if (y <= SEA_LEVEL + 1) return d < 3 ? I.SAND : d < 5 ? I.SANDSTONE : 0;
      break;
    case S_RIVER:
      if (y <= SEA_LEVEL + 1) return d < 3 ? I.SAND : 0;
      break;
    default:
  }
  // grassy default
  if (slope >= 9 && y > 90) return 0; // sheer cliffs stay stone
  if (bank && y <= SEA_LEVEL + 1) return d < 3 ? I.SAND : 0;
  if (d === 0) {
    if (cat === S_TAIGA) {
      if (n2 > 0.5) return I.PODZOL;
      if (n2 < -0.6) return I.COARSE_DIRT;
    } else if (cat === S_SAVANNA && n2 > 0.72) return I.COARSE_DIRT;
    return I.GRASS_BLOCK;
  }
  return d < dirtDepth ? I.DIRT : 0;
}

// ---------------------------------------------------------------------------------------------
// Decoration inside the column. ctx: buf, X0, Z0, seed, colBiome, colTop (terrain), fn (flower noise),
// ft (flower type noise), gn (grass clump noise), drip, lush (cave region noises), colH
const FLOWER_SALT = 0x3f1, GRASS_SALT = 0x5a2, MISC_SALT = 0x77b;
const soilGround = new Uint8Array(4096);
for (const s of [I.GRASS_BLOCK, I.DIRT, I.PODZOL, I.COARSE_DIRT]) soilGround[s] = 1;
const sandGround = new Uint8Array(4096);
sandGround[I.SAND] = 1; sandGround[I.RED_SAND] = 1;
const caveStone = new Uint8Array(4096);
for (const s of [I.STONE, I.DEEPSLATE, I.GRANITE, I.DIORITE, I.ANDESITE, I.TUFF]) caveStone[s] = 1;

export function decorate(ctx) {
  const { buf, X0, Z0, seed, colBiome } = ctx;
  const surfTop = ctx.surfTop; // Int16Array(256) filled here: highest non-air y
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const col = (lz << 4) | lx;
      const x = X0 + lx, z = Z0 + lz;
      const info = BINFO[colBiome[col]];
      // highest non-air block
      let top = Math.max(ctx.colTop[col], SEA_LEVEL);
      while (top > MIN_Y && buf[at(top, col)] === AIR) top--;
      surfTop[col] = top;
      const v = buf[at(top, col)];
      const r1 = hashf(x, z, seed, MISC_SALT);
      if (v === WATER) {
        if (info.freezes || top >= info.snowLine) { buf[at(top, col)] = I.ICE; continue; }
        if (info.lilyPad && top === SEA_LEVEL && r1 < info.lilyPad && top < 318) {
          buf[at(top + 1, col)] = I.LILY_PAD;
          continue;
        }
        let fy = top;
        while (fy > MIN_Y && buf[at(fy, col)] === WATER) fy--;
        const depth = top - fy;
        const sg = info.seagrass || 0.015;
        if (depth >= 2 && r1 < sg && IS_SOLID[buf[at(fy, col)] & 0xfff]) buf[at(fy + 1, col)] = I.SEAGRASS;
        continue;
      }
      if (v === LAVA || v === AIR || top >= 318) continue;
      const g = v & 0xfff;
      const y = top + 1;
      const cold = y >= info.snowLine;
      if (cold) {
        if (IS_SOLID[g] && g !== I.ICE && g !== I.PACKED_ICE && !LEAF_OR_PLANT[g]) buf[at(y, col)] = I.SNOW;
        continue;
      }
      if (soilGround[g]) {
        if (info.sugarCane && waterNear(buf, lx, lz, top) && r1 < info.sugarCane) {
          sugarCane(buf, col, y, x, z, seed);
          continue;
        }
        const r2 = hashf(x, z, seed, FLOWER_SALT);
        if (info.flowerChance > 0) {
          const fn = ctx.fn[col];
          const fc = info.flowerChance * (fn > 0 ? 1 + fn * 3 : Math.max(0, 1 + fn * 2));
          if (r2 < fc) {
            const list = info.flowers;
            const t = ctx.ft[col] * 0.5 + 0.5 + (hashf(x, z, seed, 91) - 0.5) * 0.35;
            let k = Math.floor(Math.max(0, Math.min(0.999, t)) * list.length);
            buf[at(y, col)] = list[k];
            continue;
          }
        }
        const r3 = hashf(x, z, seed, GRASS_SALT);
        if (info.berries && r3 > 1 - info.berries && g !== I.COARSE_DIRT) { buf[at(y, col)] = I.SWEET_BERRY_MATURE; continue; }
        if (info.mushrooms && r2 > 1 - info.mushrooms) { buf[at(y, col)] = r3 < 0.5 ? I.BROWN_MUSHROOM : I.RED_MUSHROOM; continue; }
        const gc = info.grass * (0.35 + ctx.gn[col] * 1.3);
        if (r3 < gc) {
          buf[at(y, col)] = info.fern > 0 && hashf(x, z, seed, 17) < info.fern ? I.FERN : I.GRASS;
        }
        continue;
      }
      if (sandGround[g] || g === I.TERRACOTTA) {
        if (info.sugarCane && sandGround[g] && waterNear(buf, lx, lz, top) && r1 < info.sugarCane) {
          sugarCane(buf, col, y, x, z, seed);
          continue;
        }
        if (info.cactus && sandGround[g] && lx > 0 && lx < 15 && lz > 0 && lz < 15 && r1 < info.cactus) {
          const h = 1 + Math.floor(hashf(x, z, seed, 23) * 3);
          let ok = true;
          for (let k = 0; k < h && ok; k++) {
            const yy = y + k;
            if (buf[at(yy, col)] !== AIR || buf[at(yy, col - 1)] !== AIR || buf[at(yy, col + 1)] !== AIR ||
              buf[at(yy, col - 16)] !== AIR || buf[at(yy, col + 16)] !== AIR) ok = false;
          }
          if (ok) { for (let k = 0; k < h; k++) buf[at(y + k, col)] = I.CACTUS; continue; }
        }
        if (info.deadBush && hashf(x, z, seed, 29) < info.deadBush) buf[at(y, col)] = I.DEAD_BUSH;
      }
    }
  }
  patches(ctx);
  caveDecor(ctx);
}

const LEAF_OR_PLANT = new Uint8Array(4096);
for (const p of [I.CACTUS, I.SUGAR_CANE, I.LILY_PAD, I.SNOW]) LEAF_OR_PLANT[p] = 1;

function waterNear(buf, lx, lz, y) {
  const col = (lz << 4) | lx;
  const i = at(y, col);
  return (lx > 0 && buf[i - 1] === WATER) || (lx < 15 && buf[i + 1] === WATER) ||
    (lz > 0 && buf[i - 16] === WATER) || (lz < 15 && buf[i + 16] === WATER);
}

function sugarCane(buf, col, y, x, z, seed) {
  const h = 1 + Math.floor(hashf(x, z, seed, 31) * 3);
  for (let k = 0; k < h; k++) {
    if (buf[at(y + k, col)] !== AIR) break;
    buf[at(y + k, col)] = I.SUGAR_CANE;
  }
}

// pumpkin / melon patches (kept inside the chunk)
function patches(ctx) {
  const { buf, X0, Z0, seed, colBiome, surfTop } = ctx;
  const r = new Rng(hash32(seed, X0, Z0, 0x9a7c));
  const clx = 3 + r.int(10), clz = 3 + r.int(10);
  const info = BINFO[colBiome[(clz << 4) | clx]];
  const roll = r.next();
  let block = 0, tries = 0;
  if (info.melon && roll < info.melon) { block = I.MELON; tries = 12; } else if (info.pumpkin && roll < info.pumpkin) { block = I.PUMPKIN; tries = 8; }
  if (!block) return;
  for (let t = 0; t < tries; t++) {
    const lx = clx + r.int(7) - 3, lz = clz + r.int(7) - 3;
    const col = (lz << 4) | lx;
    const top = surfTop[col];
    let g = buf[at(top, col)] & 0xfff;
    let y = top + 1;
    if (g === I.GRASS || g === I.FERN) { g = buf[at(top - 1, col)] & 0xfff; y = top; }
    if (g !== I.GRASS_BLOCK) continue;
    buf[at(y, col)] = block;
    if (y > surfTop[col]) surfTop[col] = y;
  }
}

// dripstone / moss patches in caves (regional)
function caveDecor(ctx) {
  const { buf, X0, Z0, seed, colTop } = ctx;
  for (let col = 0; col < 256; col++) {
    const dr = ctx.drip[col], lu = ctx.lush[col];
    if (dr < 0.5 && lu < 0.55) continue;
    const mode = dr >= 0.5 ? 1 : 2;
    const x = X0 + (col & 15), z = Z0 + (col >> 4);
    const yTop = Math.min(colTop[col] - 10, 60);
    for (let y = MIN_Y + 6; y < yTop; y++) {
      const i = at(y, col);
      if (buf[i] !== AIR) continue;
      const below = buf[i - 256], above = buf[i + 256];
      const h = hashf(x, y, z, seed ^ 0x6d);
      if (caveStone[below]) {
        if (mode === 1) {
          if (h < 0.75) buf[i - 256] = I.DRIPSTONE_BLOCK;
          if (h < 0.4 && caveStone[buf[i - 512]]) buf[i - 512] = I.DRIPSTONE_BLOCK;
        } else if (h < 0.85) {
          buf[i - 256] = I.MOSS_BLOCK;
        }
      }
      if (caveStone[above]) {
        if (mode === 1 && h > 0.35) buf[i + 256] = I.DRIPSTONE_BLOCK;
        else if (mode === 2 && h > 0.6) buf[i + 256] = I.MOSS_BLOCK;
      }
    }
  }
}
