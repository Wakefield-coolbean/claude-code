// Villages: one candidate per 24x24-chunk region on flat plains / desert / savanna / taiga / snowy land.
// A region's layout is planned once (well, roads, houses, farms, lamps). Each chunk emits only the
// pieces centred in it, with heights read from its own freshly generated terrain, so every chunk
// that a piece overlaps places it identically. Building designs are original to BlockCraft.
import { B, IS_SOLID } from '../../registry/blocks.js';
import { BiomeById } from '../../registry/biomes.js';
import { packBlock } from '../../constants.js';
import { Rng, hash32 } from './noise.js';

const REGION = 24; // chunks
const SEA = 63;
const STYLE_OF = {
  plains: 'plains', sunflower_plains: 'plains', meadow: 'plains', desert: 'desert', savanna: 'savanna',
  taiga: 'taiga', snowy_plains: 'snowy', snowy_taiga: 'snowy',
};
const id = (n, f = 'cobblestone') => B[n] ?? B[f];
const STYLES = {
  plains: { wall: id('oak_planks'), frame: id('oak_log'), base: id('cobblestone'), floor: id('oak_planks'), roof: id('oak_stairs'), roofTop: id('oak_slab'), gable: id('oak_planks'), road: id('dirt_path'), fence: id('oak_fence'), flat: false },
  taiga: { wall: id('spruce_planks'), frame: id('spruce_log'), base: id('cobblestone'), floor: id('spruce_planks'), roof: id('spruce_stairs'), roofTop: id('spruce_slab'), gable: id('spruce_planks'), road: id('dirt_path'), fence: id('oak_fence'), flat: false },
  snowy: { wall: id('spruce_planks'), frame: id('spruce_log'), base: id('stone_bricks'), floor: id('spruce_planks'), roof: id('spruce_stairs'), roofTop: id('spruce_slab'), gable: id('white_wool', 'spruce_planks'), road: id('dirt_path'), fence: id('oak_fence'), flat: false },
  savanna: { wall: id('acacia_planks'), frame: id('acacia_log'), base: id('cobblestone'), floor: id('acacia_planks'), roof: id('terracotta'), roofTop: id('terracotta'), gable: id('acacia_planks'), road: id('dirt_path'), fence: id('oak_fence'), flat: true },
  desert: { wall: id('sandstone'), frame: id('cut_sandstone', 'sandstone'), base: id('sandstone'), floor: id('cut_sandstone', 'sandstone'), roof: id('sandstone_slab'), roofTop: id('sandstone_slab'), gable: id('sandstone'), road: id('smooth_sandstone', 'sandstone'), fence: id('oak_fence'), flat: true },
};
// house footprints (w along the road, d away from it)
const KINDS = [
  { kind: 'small', w: 5, d: 5, weight: 4 },
  { kind: 'medium', w: 7, d: 6, weight: 3 },
  { kind: 'long', w: 9, d: 5, weight: 2 },
  { kind: 'farm', w: 9, d: 7, weight: 3 },
];

export class VillagePlanner {
  constructor(seed, climate) {
    this.seed = seed;
    this.climate = climate;
    this.cache = new Map();
    this.o = null;
  }

  // plan (or null) for the region containing chunk (cx, cz)
  regionPlan(rx, rz) {
    const key = rx + ',' + rz;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.makePlan(rx, rz);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, p);
    return p;
  }

  sampleAt(x, z) { return this.climate.sample(x, z, this.climateSample ?? (this.climateSample = makeLocalSample())); }

  makePlan(rx, rz) {
    const r = new Rng(hash32(this.seed, rx, rz, 0x5111a6e));
    // try a few spots in the region; take the first that is a village biome and fairly flat
    let cx = 0, cz = 0, style = null, h0 = 0;
    for (let attempt = 0; attempt < 4 && !style; attempt++) {
      const ccx = rx * REGION + 3 + r.int(REGION - 6), ccz = rz * REGION + 3 + r.int(REGION - 6);
      cx = ccx * 16 + 8; cz = ccz * 16 + 8;
      const s0 = this.sampleAt(cx, cz);
      const st = STYLE_OF[this.biomeName(s0.biome)];
      h0 = s0.H;
      if (!st || h0 < SEA + 1 || h0 > 120) continue;
      let ok = true;
      for (let dx = -32; dx <= 32 && ok; dx += 16) for (let dz = -32; dz <= 32 && ok; dz += 16) {
        const s = this.sampleAt(cx + dx, cz + dz);
        if (s.H < SEA + 1 || Math.abs(s.H - h0) > 9) ok = false;
      }
      if (ok) style = st;
    }
    if (!style) return null;
    const plan = { cx, cz, style, pieces: [], roads: [], box: [cx, cz, cx, cz] };
    const occ = [];
    const free = (x0, z0, x1, z1) => {
      for (const b of occ) if (x0 <= b[2] + 1 && x1 >= b[0] - 1 && z0 <= b[3] + 1 && z1 >= b[1] - 1) return false;
      for (const rd of plan.roads) if (x0 <= rd[2] && x1 >= rd[0] && z0 <= rd[3] && z1 >= rd[1]) return false;
      for (let x = x0; x <= x1; x += Math.max(1, x1 - x0)) for (let z = z0; z <= z1; z += Math.max(1, z1 - z0)) {
        const s = this.sampleAt(x, z);
        if (s.H < SEA + 1 || Math.abs(s.H - h0) > 7) return false;
      }
      return true;
    };
    const addPiece = (p) => {
      plan.pieces.push(p); occ.push([p.x0, p.z0, p.x1, p.z1]);
      plan.box = [Math.min(plan.box[0], p.x0), Math.min(plan.box[1], p.z0), Math.max(plan.box[2], p.x1), Math.max(plan.box[3], p.z1)];
    };
    addPiece({ type: 'v_well', x0: cx - 2, z0: cz - 2, x1: cx + 1, z1: cz + 1 });
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const pickKind = () => {
      let t = r.next() * KINDS.reduce((a, k) => a + k.weight, 0);
      for (const k of KINDS) { if (t < k.weight) return k; t -= k.weight; }
      return KINDS[0];
    };
    // lay a road from (sx, sz) along dir for len blocks (3 wide) and line it with buildings
    const road = (sx, sz, dir, len, depth) => {
      const [dx, dz] = dir, nx = -dz, nz = dx;
      const ex = sx + dx * len, ez = sz + dz * len;
      const rd = [Math.min(sx, ex) - (dz ? 1 : 0), Math.min(sz, ez) - (dx ? 1 : 0), Math.max(sx, ex) + (dz ? 1 : 0), Math.max(sz, ez) + (dx ? 1 : 0)];
      plan.roads.push(rd);
      plan.box = [Math.min(plan.box[0], rd[0]), Math.min(plan.box[1], rd[1]), Math.max(plan.box[2], rd[2]), Math.max(plan.box[3], rd[3])];
      addLamp(ex + nx * 2, ez + nz * 2);
      for (let t = 4; t < len - 2; t += 8 + r.int(3)) {
        for (const side of [1, -1]) {
          if (r.next() > 0.8) continue;
          const k = pickKind();
          // local frame: along = road dir, out = side * normal; front edge 2 blocks off the road edge
          const ax = sx + dx * t, az = sz + dz * t;
          const fx = ax + nx * side * 3, fz = az + nz * side * 3;
          const half = k.w >> 1;
          const cxs = [fx - dx * half, fx + dx * (k.w - 1 - half), fx + nx * side * (k.d - 1) - dx * half, fx + nx * side * (k.d - 1) + dx * (k.w - 1 - half)];
          const czs = [fz - dz * half, fz + dz * (k.w - 1 - half), fz + nz * side * (k.d - 1) - dz * half, fz + nz * side * (k.d - 1) + dz * (k.w - 1 - half)];
          const x0 = Math.min(...cxs), x1 = Math.max(...cxs), z0 = Math.min(...czs), z1 = Math.max(...czs);
          if (!free(x0, z0, x1, z1)) continue;
          // door side faces the road
          const door = nx * side > 0 ? 'w' : nx * side < 0 ? 'e' : nz * side > 0 ? 'n' : 's';
          addPiece({ type: k.kind === 'farm' ? 'v_farm' : 'v_house', kind: k.kind, x0, z0, x1, z1, door, seed: r.int(0x7fffffff) });
        }
        if (depth === 0 && r.next() < 0.35) {
          const side = r.next() < 0.5 ? 1 : -1;
          const bx = sx + dx * t + nx * side * 2, bz = sz + dz * t + nz * side * 2;
          const blen = 10 + r.int(10);
          const bex = bx + nx * side * blen, bez = bz + nz * side * blen;
          if (free(Math.min(bx, bex) - 1, Math.min(bz, bez) - 1, Math.max(bx, bex) + 1, Math.max(bz, bez) + 1)) road(bx, bz, [nx * side, nz * side], blen, 1);
        }
      }
    };
    const addLamp = (x, z) => { if (free(x, z, x, z)) addPiece({ type: 'v_lamp', x0: x, z0: z, x1: x, z1: z }); };
    const order = [0, 1, 2, 3].sort(() => r.next() - 0.5);
    let made = 0;
    for (const i of order) {
      if (made >= 2 && r.next() < 0.3) continue;
      const [dx, dz] = DIRS[i];
      road(cx + dx * 3 - (dx < 0 ? 1 : 0), cz + dz * 3 - (dz < 0 ? 1 : 0), DIRS[i], 20 + r.int(22), 0);
      made++;
    }
    // plaza ring of path around the well
    plan.roads.push([cx - 3, cz - 3, cx + 2, cz + 2]);
    if (plan.pieces.filter((p) => p.type === 'v_house').length < 2) return null;
    return plan;
  }

  biomeName(id) { return BiomeById[id]?.name; }

  // All village work for chunk (cx, cz): { pieces: [...features], mask(lx, lz) -> bool }
  forChunk(cx, cz) {
    const rx = Math.floor(cx / REGION), rz = Math.floor(cz / REGION);
    const out = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const plan = this.regionPlan(rx + dx, rz + dz);
      if (!plan) continue;
      const X0 = cx << 4, Z0 = cz << 4;
      const b = plan.box;
      if (b[2] + 3 < X0 || b[0] - 3 > X0 + 15 || b[3] + 3 < Z0 || b[1] - 3 > Z0 + 15) continue;
      out.push(plan);
    }
    return out;
  }
}

function makeLocalSample() {
  return { C: 0, E: 0, W: 0, PV: 0, T: 0, Hm: 0, H: 64, amp: 3, mtn: 0, river: 0, riverScale: 0, riverChannel: false, swamp: 0, ti: 2, hi: 2, biome: 0 };
}

// ---------------- building ----------------
const idOf = (v) => v & 0xfff;
const STAIR_FACING = { n: 0, s: 1, w: 2, e: 3 };

function clearAbove(a, x, y, z, h) { for (let i = 0; i < h; i++) a.setBlock(x, y + i, z, 0); }
function foundation(a, x, y, z, v) {
  // fill down from the floor to solid ground so buildings never float
  for (let i = 1; i <= 8; i++) {
    const c = idOf(a.getBlock(x, y - i, z));
    if (IS_SOLID[c] && c !== B.oak_leaves) break;
    a.setBlock(x, y - i, z, v);
  }
}

export function placeVillageFeature(a, f) {
  const S = STYLES[f.style] ?? STYLES.plains;
  switch (f.type) {
    case 'v_road': {
      for (const [x, z, y, wet] of f.cells) {
        if (wet) { a.setBlock(x, y, z, S.floor); clearAbove(a, x, y + 1, z, 3); continue; }
        a.setBlock(x, y, z, S.road);
        clearAbove(a, x, y + 1, z, 3);
        foundation(a, x, y, z, B.dirt);
      }
      return true;
    }
    case 'v_lamp': {
      const { x0: x, z0: z, y } = f;
      a.setBlock(x, y, z, S.base); foundation(a, x, y, z, S.base);
      a.setBlock(x, y + 1, z, S.fence); a.setBlock(x, y + 2, z, S.fence);
      a.setBlock(x, y + 3, z, B.lantern ?? B.torch);
      return true;
    }
    case 'v_well': return buildWell(a, f, S);
    case 'v_farm': return buildFarm(a, f, S);
    case 'v_house': return buildHouse(a, f, S);
    default: return false;
  }
}

function buildWell(a, f, S) {
  const { x0, z0, x1, z1, y } = f;
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) { clearAbove(a, x, y + 1, z, 5); }
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    for (let d = 0; d <= 3; d++) a.setBlock(x, y - d, z, edge || d === 3 ? S.base : B.water);
    foundation(a, x, y - 3, z, S.base);
    if (edge) a.setBlock(x, y + 1, z, S.base);
    const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
    if (corner) { a.setBlock(x, y + 2, z, S.fence); a.setBlock(x, y + 3, z, S.fence); }
    a.setBlock(x, y + 4, z, S.flat ? S.roof : S.roofTop);
  }
  return true;
}

function buildFarm(a, f, S) {
  const { x0, z0, x1, z1, y } = f;
  const r = new Rng(f.seed);
  const crops = [B.wheat, B.wheat, B.carrots, B.potatoes].filter((v) => v !== undefined);
  const crop = crops[r.int(crops.length)];
  const alongX = x1 - x0 >= z1 - z0;
  const mid = alongX ? (z0 + z1) >> 1 : (x0 + x1) >> 1;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    clearAbove(a, x, y + 1, z, 4);
    foundation(a, x, y, z, B.dirt);
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    if (edge) { a.setBlock(x, y, z, S.frame); continue; }
    if ((alongX ? z : x) === mid) { a.setBlock(x, y, z, B.water); continue; }
    a.setBlock(x, y, z, packBlock(B.farmland, 7));
    a.setBlock(x, y + 1, z, packBlock(crop, r.int(8)));
  }
  return true;
}

function buildHouse(a, f, S) {
  const { x0, z0, x1, z1, y, door } = f;
  const r = new Rng(f.seed);
  const W = x1 - x0 + 1, D = z1 - z0 + 1;
  const wallH = 3;
  // ground: floor, foundation, clear the volume
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) clearAbove(a, x, y + 1, z, 9);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    a.setBlock(x, y, z, edge ? S.base : S.floor);
    foundation(a, x, y, z, S.base);
  }
  // door position (middle of the road-facing wall)
  const dx = door === 'w' ? x0 : door === 'e' ? x1 : (x0 + x1) >> 1;
  const dz = door === 'n' ? z0 : door === 's' ? z1 : (z0 + z1) >> 1;
  // walls with log corners and windows
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    if (!edge) continue;
    const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
    for (let h = 1; h <= wallH; h++) {
      let v = corner ? S.frame : S.wall;
      const along = x === x0 || x === x1 ? z - z0 : x - x0;
      const len = x === x0 || x === x1 ? D : W;
      if (!corner && h === 2 && along % 2 === 0 && along > 0 && along < len - 1 && !(x === dx && z === dz)) v = B.glass_pane ?? B.glass;
      a.setBlock(x, y + h, z, v);
    }
  }
  // door + stoop
  const DF = { n: 0, s: 1, w: 2, e: 3 }[door];
  a.setBlock(dx, y + 1, dz, packBlock(B.oak_door, DF));
  a.setBlock(dx, y + 2, dz, packBlock(B.oak_door, 8));
  const ox = door === 'w' ? -1 : door === 'e' ? 1 : 0, oz = door === 'n' ? -1 : door === 's' ? 1 : 0;
  a.setBlock(dx + ox, y, dz + oz, S.road);
  foundation(a, dx + ox, y, dz + oz, B.dirt);
  // roof
  const top = y + wallH + 1;
  if (S.flat) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      a.setBlock(x, top, z, S.flat && S.roof === B.sandstone_slab ? S.wall : S.roof);
      if (edge && (x + z) % 2 === 0) a.setBlock(x, top + 1, z, S.roofTop);
    }
  } else {
    // gable roof: ridge runs along the longer side
    const ridgeX = W >= D;
    const span = ridgeX ? D : W;
    for (let i = 0; i * 2 < span; i++) {
      const yy = top + i;
      const lo = i, hi = span - 1 - i;
      for (let t = (ridgeX ? x0 : z0) - 1; t <= (ridgeX ? x1 : z1) + 1; t++) {
        const gableEnd = t === (ridgeX ? x0 : z0) || t === (ridgeX ? x1 : z1);
        for (const k of lo === hi ? [lo] : [lo, hi]) {
          const x = ridgeX ? t : x0 + k, z = ridgeX ? z0 + k : t;
          if (lo === hi) { a.setBlock(x, yy, z, S.roofTop); continue; }
          const facing = ridgeX ? (k === lo ? STAIR_FACING.s : STAIR_FACING.n) : (k === lo ? STAIR_FACING.e : STAIR_FACING.w);
          a.setBlock(x, yy, z, packBlock(S.roof, facing));
        }
        // fill the gable triangle under this roof course
        if (gableEnd) for (let k = lo + 1; k < hi; k++) {
          const x = ridgeX ? t : x0 + k, z = ridgeX ? z0 + k : t;
          a.setBlock(x, yy, z, S.gable);
        }
      }
    }
  }
  // interior
  const ix0 = x0 + 1, ix1 = x1 - 1, iz0 = z0 + 1, iz1 = z1 - 1;
  const spots = [];
  for (let x = ix0; x <= ix1; x++) for (let z = iz0; z <= iz1; z++) {
    const nearDoor = Math.abs(x - dx) + Math.abs(z - dz) <= 2;
    const wall = x === ix0 || x === ix1 || z === iz0 || z === iz1;
    if (wall && !nearDoor) spots.push([x, z]);
  }
  const take = () => (spots.length ? spots.splice(r.int(spots.length), 1)[0] : null);
  // bed: two cells along a wall
  const bedCells = spots.filter(([x, z]) => (x === ix0 || x === ix1) && z < iz1 && spots.some(([x2, z2]) => x2 === x && z2 === z + 1));
  if (bedCells.length && B.red_bed !== undefined) {
    const [bx, bz] = bedCells[r.int(bedCells.length)];
    a.setBlock(bx, y + 1, bz + 1, packBlock(B.red_bed, 0));      // foot, head towards -z
    a.setBlock(bx, y + 1, bz, packBlock(B.red_bed, 0 | 4));      // head
    for (let i = spots.length - 1; i >= 0; i--) if (spots[i][0] === bx && (spots[i][1] === bz || spots[i][1] === bz + 1)) spots.splice(i, 1);
  }
  const extras = f.kind === 'small' ? [B.crafting_table] : f.kind === 'medium' ? [B.crafting_table, B.chest, B.furnace] : [B.chest, B.bookshelf, B.bookshelf, B.crafting_table];
  for (const v of extras) { const s = take(); if (s && v !== undefined) a.setBlock(s[0], y + 1, s[1], v); }
  // light: a torch on the inside of the back wall
  const bx = door === 'w' ? ix1 : door === 'e' ? ix0 : (ix0 + ix1) >> 1;
  const bz = door === 'n' ? iz1 : door === 's' ? iz0 : (iz0 + iz1) >> 1;
  const tm = door === 'n' ? 2 : door === 's' ? 1 : door === 'w' ? 4 : 3; // wall is on the far side
  if (idOf(a.getBlock(bx, y + 2, bz)) === 0) a.setBlock(bx, y + 2, bz, packBlock(B.torch, tm));
  return true;
}
