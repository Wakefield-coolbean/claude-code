// Multi-chunk features placed after terrain: trees, lakes, dungeons.
// placeFeature(access, feature) only uses access.getBlock/setBlock and is deterministic from
// the feature record (its `seed`). Footprints stay within 8 blocks of the origin column.
import { IS_SOLID, IS_LIQUID } from '../../registry/blocks.js';
import { packBlock } from '../../constants.js';
import { Rng } from './noise.js';
import * as I from './ids.js';

const LEAVES = new Uint8Array(4096);
for (const l of [I.OAK_LEAVES, I.SPRUCE_LEAVES, I.BIRCH_LEAVES, I.JUNGLE_LEAVES, I.ACACIA_LEAVES, I.DARK_OAK_LEAVES]) LEAVES[l] = 1;
const PLANTS = new Uint8Array(4096); // small plants trees may overwrite
for (const p of [I.GRASS, I.FERN, I.DEAD_BUSH, I.SNOW, I.DANDELION, I.POPPY, I.BLUE_ORCHID, I.ALLIUM, I.AZURE_BLUET,
  I.RED_TULIP, I.ORANGE_TULIP, I.WHITE_TULIP, I.PINK_TULIP, I.OXEYE_DAISY, I.CORNFLOWER, I.LILY_OF_THE_VALLEY,
  I.BROWN_MUSHROOM, I.RED_MUSHROOM, I.SWEET_BERRY_BUSH, I.SUGAR_CANE]) PLANTS[p] = 1;
PLANTS[0] = 1;
const SOIL = new Uint8Array(4096);
for (const s of [I.GRASS_BLOCK, I.DIRT, I.PODZOL, I.COARSE_DIRT, I.MOSS_BLOCK]) SOIL[s] = 1;

const idOf = (v) => v & 0xfff;

class Builder {
  constructor(access, snowy) {
    this.a = access;
    this.snowy = snowy;
    this.leafPos = snowy ? [] : null;
  }
  get(x, y, z) { return this.a.getBlock(x, y, z) | 0; }
  // logs replace air, plants, leaves, snow and (for swamp trees) water
  log(x, y, z, v, allowWater = false) {
    const c = idOf(this.get(x, y, z));
    if (PLANTS[c] || LEAVES[c] || (allowWater && c === I.WATER)) { this.a.setBlock(x, y, z, v); return true; }
    return false;
  }
  leaf(x, y, z, v) {
    const c = idOf(this.get(x, y, z));
    if (c === 0 || (PLANTS[c] && !IS_LIQUID[c])) {
      this.a.setBlock(x, y, z, v);
      if (this.leafPos) this.leafPos.push(x, y, z);
      return true;
    }
    return false;
  }
  // trunk column free (air/plants/leaves) for h blocks?
  clear(x, y, z, h, allowWater = false) {
    for (let i = 0; i < h; i++) {
      const c = idOf(this.get(x, y + i, z));
      if (!(PLANTS[c] || LEAVES[c] || (allowWater && c === I.WATER))) return false;
    }
    return true;
  }
  soil(x, y, z) { return SOIL[idOf(this.get(x, y, z))] === 1; }
  dirtBelow(x, y, z) {
    const c = idOf(this.get(x, y - 1, z));
    if (c === I.GRASS_BLOCK || c === I.PODZOL || c === I.MOSS_BLOCK) this.a.setBlock(x, y - 1, z, I.DIRT);
  }
  finish() {
    if (!this.leafPos) return;
    const p = this.leafPos;
    for (let i = 0; i < p.length; i += 3) {
      if (this.get(p[i], p[i + 1] + 1, p[i + 2]) === 0) this.a.setBlock(p[i], p[i + 1] + 1, p[i + 2], I.SNOW);
    }
  }
  // square layer with optional corner trimming
  layer(cx, y, cz, rad, v, r, trim) {
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        const corner = (dx === rad || dx === -rad) && (dz === rad || dz === -rad);
        if (corner && rad > 0 && (trim === 1 || (trim === 2 && r.next() < 0.5))) continue;
        this.leaf(cx + dx, y, cz + dz, v);
      }
    }
  }
  // round blob layer: dx^2+dz^2 <= rad^2 + slack
  disc(cx, y, cz, rad, v, slack = 0.5) {
    const lim = rad * rad + slack;
    const R = Math.ceil(rad);
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz <= lim) this.leaf(cx + dx, y, cz + dz, v);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------
export function placeFeature(access, f) {
  switch (f.type) {
    case 'tree': return placeTree(access, f);
    case 'lake': return placeLake(access, f);
    case 'dungeon': return placeDungeon(access, f);
    default: return false;
  }
}

function placeTree(access, f) {
  const r = new Rng(f.seed);
  const t = new Builder(access, !!f.snowy);
  const { x, y, z } = f;
  let ok = false;
  switch (f.kind) {
    case 'oak': ok = blobTree(t, r, x, y, z, 4 + r.int(3), I.OAK_LOG, I.OAK_LEAVES, 2); break;
    case 'birch': ok = blobTree(t, r, x, y, z, 5 + r.int(3), I.BIRCH_LOG, I.BIRCH_LEAVES, 2); break;
    case 'tall_birch': ok = blobTree(t, r, x, y, z, 8 + r.int(5), I.BIRCH_LOG, I.BIRCH_LEAVES, 2); break;
    case 'jungle': ok = blobTree(t, r, x, y, z, 5 + r.int(7), I.JUNGLE_LOG, I.JUNGLE_LEAVES, 2); break;
    case 'swamp_oak': ok = blobTree(t, r, x, y, z, 5 + r.int(4), I.OAK_LOG, I.OAK_LEAVES, 3, true); break;
    case 'fancy_oak': ok = fancyOak(t, r, x, y, z); break;
    case 'spruce': ok = spruce(t, r, x, y, z); break;
    case 'pine': ok = pine(t, r, x, y, z); break;
    case 'jungle_bush': ok = bush(t, r, x, y, z); break;
    case 'mega_jungle': ok = megaJungle(t, r, x, y, z); break;
    case 'acacia': ok = acacia(t, r, x, y, z); break;
    case 'dark_oak': ok = darkOak(t, r, x, y, z); break;
    default: ok = false;
  }
  if (ok) t.finish();
  return ok;
}

// Classic oak/birch/jungle: straight trunk, 4-layer blob canopy.
function blobTree(t, r, x, y, z, h, logId, leafId, rad, swamp = false) {
  if (!t.soil(x, y - 1, z)) {
    // swamp trees may stand in 1-deep water
    if (!(swamp && idOf(t.get(x, y - 1, z)) === I.WATER && t.soil(x, y - 2, z))) return false;
    y -= 1;
  }
  if (!t.clear(x, y, z, h, swamp)) return false;
  if (!t.clear(x, y + h, z, 1)) return false;
  t.dirtBelow(x, y, z);
  const top = y + h;
  for (let yy = top - 3; yy <= top; yy++) {
    const d = top - yy; // 0 = top layer
    const rr = d <= 1 ? rad - 1 : rad;
    if (rad >= 3 && d >= 2) t.disc(x, yy, z, rr, leafId, r.next() < 0.5 ? 1.5 : 3);
    else t.layer(x, yy, z, rr, leafId, r, d === 0 ? 1 : 2);
  }
  for (let i = 0; i < h; i++) t.log(x, y + i, z, logId, swamp);
  return true;
}

function bush(t, r, x, y, z) {
  if (!t.soil(x, y - 1, z) || !t.clear(x, y, z, 1)) return false;
  t.log(x, y, z, I.JUNGLE_LOG);
  t.layer(x, y, z, 2, I.OAK_LEAVES, r, 2);
  t.layer(x, y + 1, z, 1, I.OAK_LEAVES, r, 2);
  if (r.next() < 0.5) t.leaf(x, y + 2, z, I.OAK_LEAVES);
  return true;
}

function spruce(t, r, x, y, z) {
  const h = 6 + r.int(4);
  const bare = 1 + r.int(2);
  if (!t.soil(x, y - 1, z) || !t.clear(x, y, z, h)) return false;
  t.dirtBelow(x, y, z);
  const maxR = 2 + r.int(2);
  let rad = r.int(2), cur = 1, start = 0;
  t.leaf(x, y + h, z, I.SPRUCE_LEAVES);
  for (let yy = y + h - 1; yy >= y + bare; yy--) {
    if (rad > 0) t.layer(x, yy, z, rad, I.SPRUCE_LEAVES, r, 1);
    else t.leaf(x, yy, z, I.SPRUCE_LEAVES);
    if (rad >= cur) { rad = start; start = 1; cur = Math.min(cur + 1, maxR); } else rad++;
  }
  for (let i = 0; i < h; i++) t.log(x, y + i, z, I.SPRUCE_LOG);
  return true;
}

function pine(t, r, x, y, z) {
  const h = 8 + r.int(5);
  const crown = 3 + r.int(3);
  if (!t.soil(x, y - 1, z) || !t.clear(x, y, z, h)) return false;
  t.dirtBelow(x, y, z);
  t.leaf(x, y + h, z, I.SPRUCE_LEAVES);
  t.leaf(x, y + h + 1, z, I.SPRUCE_LEAVES);
  let rad = 1;
  for (let yy = y + h - 1, k = 0; k < crown; yy--, k++) {
    t.layer(x, yy, z, rad, I.SPRUCE_LEAVES, r, 1);
    rad = k % 2 === 0 ? 2 : 1;
  }
  for (let i = 0; i < h; i++) t.log(x, y + i, z, I.SPRUCE_LOG);
  return true;
}

function fancyOak(t, r, x, y, z) {
  const h = 7 + r.int(6);
  if (!t.soil(x, y - 1, z) || !t.clear(x, y, z, h)) return false;
  t.dirtBelow(x, y, z);
  const trunkTop = y + h - 1;
  const clusters = [[x, trunkTop, z]];
  const nb = 2 + r.int(3);
  for (let i = 0; i < nb; i++) {
    const a = r.next() * Math.PI * 2;
    const len = 2 + r.next() * 2.5;
    const by = y + Math.floor(h * 0.45) + r.int(Math.max(1, Math.floor(h * 0.45)));
    const ex = x + Math.round(Math.cos(a) * len), ez = z + Math.round(Math.sin(a) * len);
    const ey = Math.min(trunkTop, by + 1 + r.int(2));
    // branch line
    const steps = Math.max(Math.abs(ex - x), Math.abs(ez - z), Math.abs(ey - by));
    const axisMeta = Math.abs(ex - x) >= Math.abs(ez - z) ? I.LOG_X : I.LOG_Z;
    for (let s = 1; s <= steps; s++) {
      const bx = x + Math.round(((ex - x) * s) / steps);
      const bz = z + Math.round(((ez - z) * s) / steps);
      const byy = by + Math.round(((ey - by) * s) / steps);
      t.log(bx, byy, bz, packBlock(I.OAK_LOG, axisMeta));
    }
    clusters.push([ex, ey, ez]);
  }
  for (const [cx, cy, cz] of clusters) {
    t.disc(cx, cy - 1, cz, 2, I.OAK_LEAVES, 0.8);
    t.disc(cx, cy, cz, 3, I.OAK_LEAVES, -1.5);
    t.disc(cx, cy + 1, cz, 2.5, I.OAK_LEAVES, 0);
    t.disc(cx, cy + 2, cz, 1.5, I.OAK_LEAVES, 0.3);
  }
  for (let i = 0; i < h; i++) t.log(x, y + i, z, I.OAK_LOG);
  return true;
}

function acacia(t, r, x, y, z) {
  const h = 5 + r.int(3) + r.int(2);
  if (!t.soil(x, y - 1, z) || !t.clear(x, y, z, 4)) return false;
  t.dirtBelow(x, y, z);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const d = DIRS[r.int(4)];
  const bendAt = h - r.int(4) - 1;
  let bendLen = 1 + r.int(3);
  let cx = x, cz = z, topY = y;
  for (let i = 0; i < h; i++) {
    const yy = y + i;
    if (i >= bendAt && bendLen > 0) { cx += d[0]; cz += d[1]; bendLen--; }
    if (t.log(cx, yy, cz, I.ACACIA_LOG)) topY = yy;
  }
  acaciaCanopy(t, r, cx, topY + 1, cz);
  // optional second branch
  if (r.next() < 0.6) {
    const d2 = DIRS[r.int(4)];
    if (d2[0] !== d[0] || d2[1] !== d[1]) {
      let bx = x, bz = z, by = y + bendAt - 1 - r.int(2);
      const len = 1 + r.int(3);
      for (let i = 0; i < len; i++) { bx += d2[0]; bz += d2[1]; by++; t.log(bx, by, bz, I.ACACIA_LOG); }
      if (len > 0) acaciaCanopy(t, r, bx, by + 1, bz, true);
    }
  }
  return true;
}
function acaciaCanopy(t, r, x, y, z, small = false) {
  const big = small ? 2 : 3;
  for (let dx = -big; dx <= big; dx++) {
    for (let dz = -big; dz <= big; dz++) {
      const ax = Math.abs(dx), az = Math.abs(dz);
      if (ax === big && az === big) continue;
      if ((ax === big || az === big) && ax + az > big + 1 && r.next() < 0.5) continue;
      t.leaf(x + dx, y - 1, z + dz, I.ACACIA_LEAVES);
    }
  }
  t.layer(x, y, z, small ? 1 : 2, I.ACACIA_LEAVES, r, 1);
}

function darkOak(t, r, x, y, z) {
  const h = 6 + r.int(3) + r.int(2);
  for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    if (!t.soil(x + dx, y - 1, z + dz)) return false;
    if (!t.clear(x + dx, y, z + dz, h)) return false;
  }
  for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) t.dirtBelow(x + dx, y, z + dz);
  const top = y + h;
  const cx = x + 0.5, cz = z + 0.5;
  for (let dy = -3; dy <= 1; dy++) {
    const rad = dy === 1 ? 2 : dy === -3 ? 2.5 : dy === -2 ? 3.5 : 4;
    const R = Math.ceil(rad) + 1;
    for (let dx = -R; dx <= R + 1; dx++) {
      for (let dz = -R; dz <= R + 1; dz++) {
        const ex = x + dx - cx, ez = z + dz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 > rad * rad + 0.6) continue;
        if (d2 > (rad - 1) * (rad - 1) && r.next() < 0.25) continue;
        t.leaf(x + dx, top + dy, z + dz, I.DARK_OAK_LEAVES);
      }
    }
  }
  for (let i = 0; i < h; i++) {
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) t.log(x + dx, y + i, z + dz, I.DARK_OAK_LOG);
  }
  // a few stubby side branches
  const nb = r.int(3);
  for (let i = 0; i < nb; i++) {
    const side = r.int(4);
    const bx = side === 0 ? x - 1 : side === 1 ? x + 2 : x + r.int(2);
    const bz = side === 2 ? z - 1 : side === 3 ? z + 2 : z + r.int(2);
    const by = top - 2 - r.int(2);
    t.log(bx, by, bz, packBlock(I.DARK_OAK_LOG, side < 2 ? I.LOG_X : I.LOG_Z));
  }
  return true;
}

function megaJungle(t, r, x, y, z) {
  const h = 12 + r.int(14);
  for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    if (!t.soil(x + dx, y - 1, z + dz)) return false;
    if (!t.clear(x + dx, y, z + dz, h)) return false;
  }
  for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) t.dirtBelow(x + dx, y, z + dz);
  const top = y + h;
  // crown
  const crown = (cy, rad) => {
    for (let dx = -5; dx <= 6; dx++) for (let dz = -5; dz <= 6; dz++) {
      const ex = dx - 0.5, ez = dz - 0.5;
      if (ex * ex + ez * ez <= rad * rad + 0.5) t.leaf(x + dx, cy, z + dz, I.JUNGLE_LEAVES);
    }
  };
  crown(top - 2, 3.5); crown(top - 1, 4.5); crown(top, 4); crown(top + 1, 2.5);
  // side branches with small leaf blobs
  const nb = 2 + r.int(3);
  for (let i = 0; i < nb; i++) {
    const by = y + Math.floor(h * 0.5) + r.int(Math.floor(h * 0.4));
    const a = r.next() * Math.PI * 2;
    const len = 2 + r.int(3);
    const ex = x + Math.round(Math.cos(a) * len), ez = z + Math.round(Math.sin(a) * len);
    const meta = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? I.LOG_X : I.LOG_Z;
    for (let s = 1; s <= len; s++) {
      t.log(x + Math.round(Math.cos(a) * s), by + (s >> 1), z + Math.round(Math.sin(a) * s), packBlock(I.JUNGLE_LOG, meta));
    }
    const ey = by + (len >> 1);
    t.disc(ex, ey, ez, 2, I.JUNGLE_LEAVES, 0.5);
    t.disc(ex, ey + 1, ez, 1.2, I.JUNGLE_LEAVES, 0.3);
  }
  for (let i = 0; i < h; i++) {
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) t.log(x + dx, y + i, z + dz, I.JUNGLE_LOG);
  }
  return true;
}

// ------------------------------------------------------------------------------------------
// Lake (MC LakeFeature): union of ellipsoids in a 16x8x16 box, fluid in the lower half.
const lakeShape = new Uint8Array(16 * 16 * 8);
function placeLake(access, f) {
  const r = new Rng(f.seed);
  const fluid = f.fluid === 'lava' ? I.LAVA : I.WATER;
  const ox = f.x - 8, oz = f.z - 8;
  let oy = f.y;
  while (oy > -59 && (access.getBlock(f.x, oy, f.z) | 0) === 0) oy--;
  if (oy <= -59) return false;
  oy -= 4;
  lakeShape.fill(0);
  const n = r.int(4) + 4;
  for (let i = 0; i < n; i++) {
    const d = r.next() * 6 + 3, e = r.next() * 4 + 2, g = r.next() * 6 + 3;
    const px = r.next() * (16 - d - 2) + 1 + d / 2;
    const py = r.next() * (8 - e - 4) + 2 + e / 2;
    const pz = r.next() * (16 - g - 2) + 1 + g / 2;
    for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) for (let y = 1; y < 7; y++) {
      const dx = (x - px) / (d / 2), dy = (y - py) / (e / 2), dz = (z - pz) / (g / 2);
      if (dx * dx + dy * dy + dz * dz < 1) lakeShape[(x * 16 + z) * 8 + y] = 1;
    }
  }
  const S = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y > 7 ? 0 : lakeShape[(x * 16 + z) * 8 + y]);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
    if (S(x, y, z)) continue;
    if (!(S(x + 1, y, z) || S(x - 1, y, z) || S(x, y + 1, z) || S(x, y - 1, z) || S(x, y, z + 1) || S(x, y, z - 1))) continue;
    const v = idOf(access.getBlock(ox + x, oy + y, oz + z) | 0);
    if (y >= 4 && IS_LIQUID[v]) return false;
    if (y < 4 && !IS_SOLID[v] && v !== fluid) return false;
  }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
    if (!S(x, y, z)) continue;
    access.setBlock(ox + x, oy + y, oz + z, y >= 4 ? I.AIR : fluid);
  }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 4; y < 8; y++) {
    if (!S(x, y, z)) continue;
    const bx = ox + x, by = oy + y - 1, bz = oz + z;
    if (idOf(access.getBlock(bx, by, bz) | 0) === I.DIRT && (access.getBlock(bx, by + 1, bz) | 0) === 0) access.setBlock(bx, by, bz, I.GRASS_BLOCK);
    // clear floating plants above the carved air
    const above = idOf(access.getBlock(bx, oy + 8, bz) | 0);
    if (y === 7 && PLANTS[above] && above !== 0) access.setBlock(bx, oy + 8, bz, I.AIR);
  }
  if (fluid === I.LAVA) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
      if (S(x, y, z)) continue;
      if (!(S(x + 1, y, z) || S(x - 1, y, z) || S(x, y + 1, z) || S(x, y - 1, z) || S(x, y, z + 1) || S(x, y, z - 1))) continue;
      if ((y < 4 || r.next() < 0.5)) {
        const v = idOf(access.getBlock(ox + x, oy + y, oz + z) | 0);
        if (IS_SOLID[v] && !LEAVES[v]) access.setBlock(ox + x, oy + y, oz + z, I.STONE);
      }
    }
  } else if (f.frozen) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      if (S(x, 3, z)) access.setBlock(ox + x, oy + 3, oz + z, I.ICE);
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------
// Dungeon (MC MonsterRoomFeature)
function placeDungeon(access, f) {
  const r = new Rng(f.seed);
  const { x, y, z } = f;
  const xr = r.int(2) + 2, zr = r.int(2) + 2;
  const minX = -xr - 1, maxX = xr + 1, minZ = -zr - 1, maxZ = zr + 1;
  const solid = (bx, by, bz) => IS_SOLID[idOf(access.getBlock(bx, by, bz) | 0)] === 1;
  const empty = (bx, by, bz) => (access.getBlock(bx, by, bz) | 0) === 0;
  let openings = 0;
  for (let dx = minX; dx <= maxX; dx++) for (let dy = -1; dy <= 4; dy++) for (let dz = minZ; dz <= maxZ; dz++) {
    const s = solid(x + dx, y + dy, z + dz);
    if (dy === -1 && !s) return false;
    if (dy === 4 && !s) return false;
    if ((dx === minX || dx === maxX || dz === minZ || dz === maxZ) && dy === 0 &&
      empty(x + dx, y, z + dz) && empty(x + dx, y + 1, z + dz)) openings++;
  }
  if (openings < 1 || openings > 5) return false;
  for (let dx = minX; dx <= maxX; dx++) for (let dy = 3; dy >= -1; dy--) for (let dz = minZ; dz <= maxZ; dz++) {
    const bx = x + dx, by = y + dy, bz = z + dz;
    const edge = dx === minX || dx === maxX || dz === minZ || dz === maxZ || dy === -1;
    const cur = idOf(access.getBlock(bx, by, bz) | 0);
    if (!edge) {
      if (cur !== I.CHEST && cur !== I.SPAWNER) access.setBlock(bx, by, bz, I.AIR);
    } else if (by > -64 && !solid(bx, by - 1, bz)) {
      access.setBlock(bx, by, bz, I.AIR);
    } else if (IS_SOLID[cur] && cur !== I.CHEST) {
      access.setBlock(bx, by, bz, dy === -1 && r.int(4) !== 0 ? I.MOSSY_COBBLESTONE : I.COBBLESTONE);
    }
  }
  for (let c = 0; c < 2; c++) {
    for (let tries = 0; tries < 3; tries++) {
      const cx = x + r.int(xr * 2 + 1) - xr, cz = z + r.int(zr * 2 + 1) - zr;
      if (!empty(cx, y, cz)) continue;
      let n = 0, facing = 0;
      if (solid(cx - 1, y, cz)) { n++; facing = 3; }
      if (solid(cx + 1, y, cz)) { n++; facing = 2; }
      if (solid(cx, y, cz - 1)) { n++; facing = 1; }
      if (solid(cx, y, cz + 1)) { n++; facing = 0; }
      if (n === 1) { access.setBlock(cx, y, cz, packBlock(I.CHEST, facing)); break; }
    }
  }
  access.setBlock(x, y, z, I.SPAWNER);
  return true;
}
