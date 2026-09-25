// Block behaviour: neighbour updates, scheduled ticks (fluids, falling blocks), random ticks (growth, decay).
import { ID_MASK, packBlock, MIN_Y } from '../constants.js';
import { BlockById, B, IS_OPAQUE, IS_SOLID, IS_REPLACEABLE } from '../registry/blocks.js';
import { SB_ALL } from '../world/world.js';
import { getCollisionBoxes } from '../registry/shapes.js';
import { tryLightPortal, portalStillValid } from './portal.js';

const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const idOf = (v) => v & ID_MASK;
const metaOf = (v) => v >>> 12;

export class BlockLogic {
  constructor(game) {
    this.game = game;
  }
  get world() { return this.game.world; }

  // ----- neighbour notifications -----
  onBlockChanged(x, y, z, oldV, newV) {
    const w = this.world;
    for (const [dx, dy, dz] of DIRS6) this.neighborChanged(x + dx, y + dy, z + dz, x, y, z);
    // the changed block itself may need ticking (placed sand / water)
    this.checkSelf(x, y, z, newV);
    // grass under a newly placed opaque block turns to dirt
    const below = w.getBlock(x, y - 1, z);
    if (idOf(below) === B.grass_block && IS_OPAQUE[idOf(newV)]) w.setBlock(x, y - 1, z, B.dirt);
    // track enchanting tables for the floating book renderer
    if (idOf(newV) === B.enchanting_table) this.game.enchTables?.set(`${x},${y},${z}`, { x, y, z });
    else if (idOf(oldV) === B.enchanting_table) this.game.enchTables?.delete(`${x},${y},${z}`);
    // fire placed inside an obsidian frame opens a nether portal
    if (idOf(newV) === B.fire && idOf(oldV) !== B.fire && w.dimension !== 'end') {
      const portal = tryLightPortal(w, x, y, z);
      if (portal) this.game.registerPortalNear?.(w.dimension, portal.x0, portal.y0, portal.z0);
    }
  }

  checkSelf(x, y, z, v) {
    const def = BlockById[idOf(v)];
    if (def.gravity) this.world.scheduleTick(x, y, z, 2);
    if (def.liquid) this.world.scheduleTick(x, y, z, this.fluidDelay(def.liquid));
  }

  neighborChanged(x, y, z, fx, fy, fz) {
    const w = this.world;
    const v = w.getBlock(x, y, z);
    if (v === 0) return;
    const def = BlockById[idOf(v)];
    if (def.liquid) { w.scheduleTick(x, y, z, this.fluidDelay(def.liquid)); return; }
    if (def.waterlogged) w.scheduleTick(x, y, z, 5);
    if (def.gravity) { w.scheduleTick(x, y, z, 2); return; }
    if (def.support && !this.canSurvive(x, y, z, v, def)) {
      this.breakNaturally(x, y, z, v);
      return;
    }
    if (def.id === B.nether_portal && !portalStillValid(w, x, y, z, v)) { w.setBlock(x, y, z, 0); return; }
    if (def.id === B.soul_fire) {
      const bid = idOf(w.getBlock(x, y - 1, z));
      if (bid !== B.soul_sand && bid !== B.soul_soil) { w.setBlock(x, y, z, 0); return; }
    }
    if (def.shape === 'door') this.checkDoor(x, y, z, v);
    if (def.shape === 'bed') this.checkBed(x, y, z, v);
    if (def.name === 'cactus') {
      for (const [dx, dz] of HORIZ) {
        const n = BlockById[idOf(w.getBlock(x + dx, y, z + dz))];
        if (n.solid || n.liquid === 'lava') { this.breakNaturally(x, y, z, v); return; }
      }
    }
    if (def.name === 'tnt') { /* redstone not implemented */ }
    void fx; void fy; void fz;
  }

  // ----- support rules -----
  canSurvive(x, y, z, v, def) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    const bid = idOf(below);
    const bdef = BlockById[bid];
    switch (def.support) {
      case 'soil': {
        if (def.berry) return bid === B.grass_block || bid === B.dirt || bid === B.podzol || bid === B.coarse_dirt || bid === B.farmland;
        return bid === B.grass_block || bid === B.dirt || bid === B.podzol || bid === B.coarse_dirt || bid === B.farmland || bid === B.moss_block;
      }
      case 'farmland': return bid === B.farmland;
      case 'soul_sand': return bid === B.soul_sand;
      case 'nylium': return bid === B.crimson_nylium || bid === B.warped_nylium || bid === B.soul_soil || bid === B.grass_block || bid === B.dirt || bid === B.podzol || bid === B.coarse_dirt || bid === B.farmland || bid === B.moss_block;
      case 'lantern': {
        if (metaOf(v) & 2) { // hanging
          const above = w.getBlock(x, y + 1, z);
          return this.canSupportCenter(above) || this.isSturdy(above, 'side') || BlockById[idOf(above)].shape === 'wall';
        }
        return this.canSupportCenter(below) || BlockById[bid].shape === 'wall';
      }
      case 'mushroom': return bdef.opaque && w.getBlockLight(x, y, z) < 13 || bid === B.podzol;
      case 'dead_bush': return bid === B.sand || bid === B.red_sand || bid === B.terracotta || bid === B.dirt || bid === B.podzol || bid === B.coarse_dirt || bid === B.grass_block;
      case 'sand': return (bid === B.sand || bid === B.red_sand || bid === B.cactus);
      case 'cane': {
        if (bid === B.sugar_cane) return true;
        if (!(bid === B.grass_block || bid === B.dirt || bid === B.sand || bid === B.red_sand || bid === B.podzol || bid === B.coarse_dirt || bid === B.moss_block)) return false;
        for (const [dx, dz] of HORIZ) {
          const n = BlockById[idOf(w.getBlock(x + dx, y - 1, z + dz))];
          if (n.liquid === 'water' || n.name === 'ice' || n.waterlogged) return true;
        }
        return false;
      }
      case 'solid': return this.isSturdy(below, 'up') || (def.name === 'snow' && (bdef.leaves || bid === B.snow && metaOf(below) === 7));
      case 'any': return bid !== 0 && !bdef.liquid;
      case 'water': return bdef.liquid === 'water' && metaOf(below) === 0 || bid === B.ice;
      case 'torch': {
        const m = metaOf(v);
        if (m === 0) return this.canSupportCenter(below);
        const [dx, dz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][m - 1];
        return this.isSturdy(w.getBlock(x + dx, y, z + dz), 'side');
      }
      case 'wall': {
        const m = metaOf(v) & 3;
        const [dx, dz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][m];
        return this.isSturdy(w.getBlock(x + dx, y, z + dz), 'side');
      }
      case 'door': {
        const upper = (metaOf(v) & 8) !== 0;
        if (upper) return idOf(w.getBlock(x, y - 1, z)) === def.id;
        return this.isSturdy(below, 'up') && idOf(w.getBlock(x, y + 1, z)) === def.id;
      }
      default: return true;
    }
  }

  isSturdy(v, face) {
    const def = BlockById[idOf(v)];
    if (def.opaque && def.solid) return true;
    if (def.shape === 'slab') { const m = metaOf(v); return m === 2 || (face === 'up' && m === 1); }
    if (def.shape === 'stairs' && face === 'up') return (metaOf(v) & 4) !== 0;
    if (def.name === 'glass' || def.leaves || def.name === 'ice') return face === 'up' ? def.name !== 'ice' || true : true;
    return false;
  }
  canSupportCenter(v) {
    const def = BlockById[idOf(v)];
    if (this.isSturdy(v, 'up')) return true;
    return def.shape === 'fence' || def.shape === 'pane';
  }

  checkDoor(x, y, z, v) {
    const w = this.world;
    const upper = (metaOf(v) & 8) !== 0;
    const other = w.getBlock(x, y + (upper ? -1 : 1), z);
    if (idOf(other) !== idOf(v)) w.setBlock(x, y, z, 0);
  }
  checkBed(x, y, z, v) {
    const w = this.world;
    const m = metaOf(v);
    const facing = m & 3, head = (m & 4) !== 0;
    const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][facing];
    const ox = head ? -d[0] : d[0], oz = head ? -d[1] : d[1];
    const other = w.getBlock(x + ox, y, z + oz);
    if (idOf(other) !== idOf(v)) w.setBlock(x, y, z, 0);
  }

  // Break a block and drop its items (not player-caused)
  breakNaturally(x, y, z, v) {
    const def = BlockById[idOf(v)];
    this.world.setBlock(x, y, z, def.waterlogged ? packBlock(B.water, 0) : 0);
    this.game.fx?.blockBreak?.(x, y, z, v);
    this.game.dropBlockItems?.(x, y, z, v, null);
  }

  // ----- scheduled ticks -----
  scheduledTick(x, y, z, v) {
    const def = BlockById[idOf(v)];
    if (def.liquid) this.tickFluid(x, y, z, v, def);
    else if (def.gravity) this.tickFalling(x, y, z, v);
    else if (def.waterlogged) this.spreadFrom(x, y, z, packBlock(B.water, 0), 'water');
    else if (def.name === 'fire') this.tickFire(x, y, z, v);
  }

  tickFalling(x, y, z, v) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    if (y > MIN_Y && this.isFree(below)) {
      w.setBlock(x, y, z, 0);
      this.game.spawnFallingBlock?.(x, y, z, v);
    }
  }
  isFree(v) {
    const def = BlockById[idOf(v)];
    return v === 0 || def.liquid || def.replaceable || def.name === 'fire';
  }

  // ----- fluids (Minecraft FlowingFluid) -----
  fluidAmount(v, kind) {
    const def = BlockById[idOf(v)];
    if (def.waterlogged && kind === 'water') return 8;
    if (def.liquid !== kind) return 0;
    const m = metaOf(v);
    if (m === 0 || m >= 8) return 8;
    return 8 - m;
  }
  isSource(v, kind) {
    const def = BlockById[idOf(v)];
    if (def.waterlogged && kind === 'water') return true;
    return def.liquid === kind && metaOf(v) === 0;
  }
  fluidBlock(kind) { return kind === 'water' ? B.water : B.lava; }
  // lava flows faster and further in ultrawarm dimensions (the Nether)
  fluidDelay(kind) { return kind === 'water' ? 5 : this.world.ultrawarm ? 10 : 30; }

  newLiquidState(x, y, z, kind) {
    const w = this.world;
    let maxAmount = 0, sources = 0;
    for (const [dx, dz] of HORIZ) {
      const n = w.getBlock(x + dx, y, z + dz);
      const a = this.fluidAmount(n, kind);
      if (a > 0) {
        if (this.isSource(n, kind)) sources++;
        if (a > maxAmount) maxAmount = a;
      }
    }
    if (kind === 'water' && sources >= 2) {
      const below = w.getBlock(x, y - 1, z);
      const bdef = BlockById[idOf(below)];
      if ((bdef.solid && !bdef.liquid) || this.isSource(below, kind)) return packBlock(this.fluidBlock(kind), 0);
    }
    const above = w.getBlock(x, y + 1, z);
    if (this.fluidAmount(above, kind) > 0) return packBlock(this.fluidBlock(kind), 8);
    const drop = kind === 'water' || this.world.ultrawarm ? 1 : 2;
    const k = maxAmount - drop;
    if (k <= 0) return 0;
    return packBlock(this.fluidBlock(kind), 8 - k);
  }

  canHoldFluid(v) {
    const def = BlockById[idOf(v)];
    if (v === 0) return true;
    if (def.liquid) return false;
    if (def.solid || def.shape === 'door' || def.climbable || def.name === 'sugar_cane' || def.waterlogged) return false;
    return def.replaceable || def.render === 'cross' || def.shape === 'torch' || def.shape === 'crop' || def.render === 'model' && !def.solid;
  }

  canSpreadTo(nx, ny, nz, newV, kind) {
    const w = this.world;
    const cur = w.getBlock(nx, ny, nz);
    const def = BlockById[idOf(cur)];
    if (def.liquid === kind) {
      if (this.isSource(cur, kind)) return false;
      return this.fluidAmount(newV, kind) > this.fluidAmount(cur, kind) || (metaOf(newV) === 8 && metaOf(cur) !== 8);
    }
    if (def.liquid && def.liquid !== kind) return true; // interaction handled in spreadTo
    return this.canHoldFluid(cur);
  }

  spreadTo(nx, ny, nz, newV, kind, downward) {
    const w = this.world;
    const cur = w.getBlock(nx, ny, nz);
    const def = BlockById[idOf(cur)];
    if (kind === 'lava' && def.liquid === 'water') {
      if (downward) { w.setBlock(nx, ny, nz, B.stone); this.fizz(nx, ny, nz); }
      return;
    }
    if (kind === 'water' && def.liquid === 'lava') {
      w.setBlock(nx, ny, nz, this.isSource(cur, 'lava') ? B.obsidian : B.cobblestone);
      this.fizz(nx, ny, nz);
      return;
    }
    if (cur !== 0 && !def.liquid) {
      // wash away plants/torches
      this.game.dropBlockItems?.(nx, ny, nz, cur, null);
    }
    w.setBlock(nx, ny, nz, newV);
    w.scheduleTick(nx, ny, nz, this.fluidDelay(kind));
  }

  fizz(x, y, z) {
    this.game.sound?.play('random.fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.5, pitch: 2.6 + (Math.random() - Math.random()) * 0.8 });
    this.game.fx?.smoke?.(x, y, z);
  }

  // lava touching water hardens (checked on lava ticks)
  lavaInteract(x, y, z, v) {
    const w = this.world;
    for (const [dx, dy, dz] of DIRS6) {
      if (dy === -1) continue;
      const n = w.getBlock(x + dx, y + dy, z + dz);
      if (BlockById[idOf(n)].liquid === 'water') {
        w.setBlock(x, y, z, this.isSource(v, 'lava') ? B.obsidian : B.cobblestone);
        this.fizz(x, y, z);
        return true;
      }
    }
    return false;
  }

  tickFluid(x, y, z, v, def) {
    const w = this.world;
    const kind = def.liquid;
    if (kind === 'lava' && this.lavaInteract(x, y, z, v)) return;
    let state = v;
    if (!this.isSource(v, kind)) {
      const ns = this.newLiquidState(x, y, z, kind);
      if (ns === 0) { w.setBlock(x, y, z, 0); return; }
      if (ns !== v) {
        w.setBlock(x, y, z, ns);
        state = ns;
      }
    }
    this.spreadFrom(x, y, z, state, kind);
  }

  spreadFrom(x, y, z, state, kind) {
    const w = this.world;
    // flow down first
    if (y > MIN_Y) {
      const below = w.getBlock(x, y - 1, z);
      const newBelow = packBlock(this.fluidBlock(kind), 8);
      if (this.canSpreadTo(x, y - 1, z, newBelow, kind) && !this.isSource(below, kind)) {
        this.spreadTo(x, y - 1, z, newBelow, kind, true);
        let srcN = 0;
        for (const [dx, dz] of HORIZ) if (this.isSource(w.getBlock(x + dx, y, z + dz), kind)) srcN++;
        if (srcN >= 3) this.spreadSides(x, y, z, state, kind);
        return;
      }
      const bdef = BlockById[idOf(below)];
      const hole = bdef.liquid === kind || this.canHoldFluid(below);
      if (!this.isSource(state, kind) && hole) return;
    }
    this.spreadSides(x, y, z, state, kind);
  }

  spreadSides(x, y, z, state, kind) {
    const drop = kind === 'water' || this.world.ultrawarm ? 1 : 2;
    let amount = this.fluidAmount(state, kind);
    if (metaOf(state) >= 8 && !this.isSource(state, kind)) amount = 8;
    amount -= drop;
    if (this.isSource(state, kind)) amount = 8 - drop;
    if (amount <= 0) return;
    const newV = packBlock(this.fluidBlock(kind), 8 - amount);
    const slopeDist = kind === 'water' || this.world.ultrawarm ? 4 : 2;
    const dirs = [];
    let best = 1000;
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = HORIZ[i];
      const nx = x + dx, nz = z + dz;
      if (!this.canSpreadTo(nx, y, nz, newV, kind)) continue;
      const d = this.holeDistance(nx, y, nz, 1, slopeDist, i ^ 1, kind);
      if (d < best) { best = d; dirs.length = 0; }
      if (d <= best) dirs.push(i);
    }
    for (const i of dirs) {
      const [dx, dz] = HORIZ[i];
      this.spreadTo(x + dx, y, z + dz, newV, kind, false);
    }
  }

  holeDistance(x, y, z, depth, max, fromDir, kind) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    if (this.canHoldFluid(below) || BlockById[idOf(below)].liquid === kind && !this.isSource(below, kind)) return depth - 1;
    if (depth >= max) return 1000;
    let best = 1000;
    for (let i = 0; i < 4; i++) {
      if (i === fromDir) continue;
      const [dx, dz] = HORIZ[i];
      const n = w.getBlock(x + dx, y, z + dz);
      if (!this.canHoldFluid(n) && !(BlockById[idOf(n)].liquid === kind && !this.isSource(n, kind))) continue;
      const d = this.holeDistance(x + dx, y, z + dz, depth + 1, max, i ^ 1, kind);
      if (d < best) best = d;
    }
    return best;
  }

  // ----- random ticks -----
  randomTick(x, y, z, v, def) {
    const w = this.world;
    const id = def.id;
    const r = Math.random;
    if (id === B.grass_block) {
      const above = w.getBlock(x, y + 1, z);
      const adef = BlockById[idOf(above)];
      if ((adef.opaque || adef.liquid) && w.getRawBrightness(x, y + 1, z, 0) < 4) { w.setBlock(x, y, z, B.dirt); return; }
      if (w.getRawBrightness(x, y + 1, z, 0) >= 9) {
        for (let i = 0; i < 4; i++) {
          const tx = x + Math.floor(r() * 3) - 1, ty = y + Math.floor(r() * 5) - 3, tz = z + Math.floor(r() * 3) - 1;
          if (idOf(w.getBlock(tx, ty, tz)) !== B.dirt) continue;
          const ab = BlockById[idOf(w.getBlock(tx, ty + 1, tz))];
          if (!ab.opaque && !ab.liquid && w.getRawBrightness(tx, ty + 1, tz, 0) >= 4) w.setBlock(tx, ty, tz, B.grass_block);
        }
      }
      return;
    }
    if (def.leaves) {
      if (metaOf(v) & 1) return; // persistent
      if (!this.logNearby(x, y, z, 5)) {
        this.breakNaturally(x, y, z, v);
      }
      return;
    }
    if (def.netherWart) {
      const age = metaOf(v);
      if (age < 3 && r() < 0.1) w.setBlock(x, y, z, packBlock(id, age + 1));
      return;
    }
    if (def.crop) {
      const age = metaOf(v);
      if (age >= 7) return;
      if (w.getRawBrightness(x, y + 1, z, 0) < 9) return;
      const speed = this.growthSpeed(x, y, z, id);
      if (r() < 1 / (Math.floor(25 / speed) + 1)) w.setBlock(x, y, z, packBlock(id, age + 1));
      return;
    }
    if (def.sapling) {
      if (w.getRawBrightness(x, y + 1, z, 0) >= 9 && r() < 1 / 7) {
        const m = metaOf(v);
        if (m === 0) w.setBlock(x, y, z, packBlock(id, 1), SB_ALL);
        else this.game.growTree?.(x, y, z, def.sapling);
      }
      return;
    }
    if (id === B.sugar_cane || id === B.cactus) {
      if (idOf(w.getBlock(x, y + 1, z)) !== 0) return;
      let h = 1;
      while (idOf(w.getBlock(x, y - h, z)) === id) h++;
      if (h >= 3) return;
      const age = metaOf(v);
      if (age >= 15) {
        w.setBlock(x, y + 1, z, id);
        w.setBlock(x, y, z, packBlock(id, 0), 0);
      } else w.setBlock(x, y, z, packBlock(id, age + 1), 0);
      return;
    }
    if (id === B.farmland) {
      const moist = this.waterNear(x, y, z);
      const m = metaOf(v);
      if (moist || w.raining && w.canSeeSky(x, y + 1, z)) { if (m < 7) w.setBlock(x, y, z, packBlock(id, 7)); }
      else if (m > 0) w.setBlock(x, y, z, packBlock(id, m - 1));
      else {
        const above = BlockById[idOf(w.getBlock(x, y + 1, z))];
        if (!above.crop) w.setBlock(x, y, z, B.dirt);
      }
      return;
    }
    if (id === B.snow || id === B.ice) {
      if (w.getBlockLight(x, y, z) > 11) {
        if (id === B.ice) w.setBlock(x, y, z, BlockById[idOf(w.getBlock(x, y - 1, z))].solid || BlockById[idOf(w.getBlock(x, y - 1, z))].liquid ? B.water : 0);
        else w.setBlock(x, y, z, 0);
      }
      return;
    }
    if (def.berry) {
      const age = metaOf(v);
      if (age < 3 && r() < 0.2 && w.getRawBrightness(x, y + 1, z, 0) >= 9) w.setBlock(x, y, z, packBlock(id, age + 1));
      return;
    }
    if (id === B.fire) { this.tickFire(x, y, z, v); return; }
  }

  growthSpeed(x, y, z, id) {
    const w = this.world;
    let f = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = w.getBlock(x + dx, y - 1, z + dz);
      let g = 0;
      if (idOf(b) === B.farmland) { g = 1; if (metaOf(b) > 0) g = 3; }
      if (dx !== 0 || dz !== 0) g /= 4;
      f += g;
    }
    // same crops in rows grow slower
    const n = idOf(w.getBlock(x, y, z - 1)) === id || idOf(w.getBlock(x, y, z + 1)) === id;
    const e = idOf(w.getBlock(x - 1, y, z)) === id || idOf(w.getBlock(x + 1, y, z)) === id;
    if (n && e) f /= 2;
    return f;
  }

  waterNear(x, y, z) {
    const w = this.world;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = 0; dy <= 1; dy++) {
      const d = BlockById[idOf(w.getBlock(x + dx, y + dy, z + dz))];
      if (d.liquid === 'water' || d.waterlogged) return true;
    }
    return false;
  }

  logNearby(x, y, z, r) {
    const w = this.world;
    // BFS through leaves (Minecraft uses distance through leaves/logs)
    const seen = new Set();
    let frontier = [[x, y, z]];
    for (let d = 0; d <= r; d++) {
      const next = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [dx, dy, dz] of DIRS6) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          const k = `${nx},${ny},${nz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const def = BlockById[idOf(w.getBlock(nx, ny, nz))];
          if (def.name.endsWith('_log')) return true;
          if (def.leaves) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return false;
  }

  // ----- fire -----
  tickFire(x, y, z, v) {
    const w = this.world;
    const age = metaOf(v);
    const below = BlockById[idOf(w.getBlock(x, y - 1, z))];
    const infinite = below.name === 'netherrack' || below.name === 'magma_block';
    if (w.raining && w.canSeeSky(x, y, z) && Math.random() < 0.2 + age * 0.03) { w.setBlock(x, y, z, 0); return; }
    if (!infinite) {
      if (!this.hasFlammableNeighbour(x, y, z) && (!below.solid || age > 3)) { w.setBlock(x, y, z, 0); return; }
      if (age >= 15 && !below.flammable && Math.random() < 0.25) { w.setBlock(x, y, z, 0); return; }
    }
    if (age < 15) w.setBlock(x, y, z, packBlock(B.fire, Math.min(15, age + 1 + Math.floor(Math.random() * 3) / 2)), 2);
    w.scheduleTick(x, y, z, 30 + Math.floor(Math.random() * 10));
    if (!this.world.gamerules.doFireTick) return;
    // burn neighbours
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const nv = w.getBlock(nx, ny, nz);
      const nd = BlockById[idOf(nv)];
      if (nd.flammable && Math.random() < 0.08) {
        if (nd.name === 'tnt') { w.setBlock(nx, ny, nz, 0); this.game.primeTnt?.(nx, ny, nz, null); continue; }
        w.setBlock(nx, ny, nz, Math.random() < 0.5 ? packBlock(B.fire, 0) : 0);
        if (idOf(w.getBlock(nx, ny, nz)) === B.fire) w.scheduleTick(nx, ny, nz, 30);
      }
    }
    // spread to nearby air next to flammables
    for (let i = 0; i < 2; i++) {
      const nx = x + Math.floor(Math.random() * 3) - 1, ny = y + Math.floor(Math.random() * 5) - 1, nz = z + Math.floor(Math.random() * 3) - 1;
      if (w.getBlock(nx, ny, nz) === 0 && this.hasFlammableNeighbour(nx, ny, nz) && Math.random() < 0.15) {
        w.setBlock(nx, ny, nz, packBlock(B.fire, 0));
        w.scheduleTick(nx, ny, nz, 30);
      }
    }
  }
  hasFlammableNeighbour(x, y, z) {
    for (const [dx, dy, dz] of DIRS6) if (BlockById[idOf(this.world.getBlock(x + dx, y + dy, z + dz))].flammable) return true;
    return false;
  }

  onBlockEntityRemoved(x, y, z, be) {
    if (be && be.items) {
      for (const s of be.items) if (s) this.game.spawnItem?.(x + 0.5, y + 0.5, z + 0.5, s, { scatter: true });
    }
  }
}

export function isSolidTop(v) { const def = BlockById[v & ID_MASK]; return def.solid && getCollisionBoxes(def, v >>> 12, () => 0).some((b) => b[4] >= 1); }
export { IS_SOLID, IS_REPLACEABLE };
