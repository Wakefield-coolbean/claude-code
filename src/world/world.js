import { MIN_Y, MAX_Y, SECTION_COUNT, ID_MASK, blockId, packBlock, DAY_LENGTH } from '../constants.js';
import { BlockById, IS_OPAQUE, IS_SOLID, B, LIGHT_FILTER } from '../registry/blocks.js';
import { BiomeById } from '../registry/biomes.js';
import { Chunk, chunkKey, CS_EMPTY, CS_TERRAIN, CS_DECORATED, CS_LIT } from './chunk.js';
import { LightEngine } from './lighting.js';
import { getCollisionBoxes } from '../registry/shapes.js';
import { Random } from '../util/rng.js';

// setBlock flags
export const SB_LIGHT = 1;     // update lighting
export const SB_MESH = 2;      // mark meshes dirty
export const SB_NOTIFY = 4;    // notify neighbours (physics, support, fluids)
export const SB_SAVE = 8;      // mark chunk as modified
export const SB_ALL = 15;

export class World {
  constructor({ seed, name = 'World', type = 'default', generator, storage = null, id = null }) {
    this.seed = seed;
    this.name = name;
    this.type = type;
    this.id = id;
    this.generator = generator; // GeneratorPool
    this.storage = storage;
    this.chunks = new Map();
    this.light = new LightEngine(this);
    this.dirtyChunks = new Set(); // chunks with dirty sections
    this.time = 0;        // total ticks
    this.dayTime = 1000;  // 0..23999
    this.rain = 0; this.thunder = 0; this.raining = false; this.thundering = false;
    this.weatherTimer = 12000 + Math.floor(Math.random() * 150000);
    this.rand = new Random((seed ^ 0x5deece66d) | 0);
    this.scheduled = new Map();   // key -> { x,y,z, due, id }
    this.behavior = null;         // set by game (block logic callbacks)
    this.entityHooks = null;      // set by game (for spawning items etc.)
    this.gamerules = { doDaylightCycle: true, doMobSpawning: true, keepInventory: false, doFireTick: true, mobGriefing: true, doWeatherCycle: true, randomTickSpeed: 3, naturalRegeneration: true };
    this.difficulty = 2; // 0 peaceful, 1 easy, 2 normal, 3 hard
    this.spawn = { x: 0, y: 80, z: 0 };
    this._lastChunk = null;
    this.loadRadius = 8;
    this.pendingLoads = 0;
    this.stats = { genTime: 0, lightTime: 0, decoTime: 0 };
  }

  // ---------- chunk access ----------
  getChunk(cx, cz) {
    const lc = this._lastChunk;
    if (lc !== null && lc.cx === cx && lc.cz === cz) return lc;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c !== undefined) this._lastChunk = c;
    return c;
  }

  getBlock(x, y, z) {
    if (y < MIN_Y || y >= MAX_Y) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (c === undefined || c.state < CS_TERRAIN) return 0;
    return c.getLocal(x & 15, y, z & 15);
  }
  getBlockId(x, y, z) { return this.getBlock(x, y, z) & ID_MASK; }
  getBlockDef(x, y, z) { return BlockById[this.getBlock(x, y, z) & ID_MASK]; }

  isLoaded(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c !== undefined && c.state >= CS_LIT;
  }

  getLight(x, y, z) {
    if (y >= MAX_Y) return 0xf0;
    if (y < MIN_Y) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (c === undefined || c.state < CS_LIT) return 0xf0;
    return c.getLightLocal(x & 15, y, z & 15);
  }
  getSkyLight(x, y, z) { return this.getLight(x, y, z) >> 4; }
  getBlockLight(x, y, z) { return this.getLight(x, y, z) & 15; }

  // Effective combined light like Minecraft's getMaxLocalRawBrightness (sky reduced at night)
  getRawBrightness(x, y, z, skyDarken = this.skyDarken()) {
    const l = this.getLight(x, y, z);
    return Math.max((l >> 4) - skyDarken, l & 15);
  }

  getHeight(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || c.state < CS_LIT) return MIN_Y;
    return c.heightmap[(z & 15) * 16 + (x & 15)];
  }

  // highest non-air, motion-blocking block
  getTopSolidY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || c.state < CS_TERRAIN) return MIN_Y - 1;
    const top = c.topSection();
    for (let y = MIN_Y + (top + 1) * 16 - 1; y >= MIN_Y; y--) {
      const id = c.getLocal(x & 15, y, z & 15) & ID_MASK;
      if (IS_SOLID[id] || BlockById[id].liquid) return y;
    }
    return MIN_Y - 1;
  }

  canSeeSky(x, y, z) { return this.getSkyLight(x, y, z) >= 15 && y > this.getHeight(x, z); }

  getBiome(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || c.state < CS_TERRAIN) return 0;
    return c.biomes[(z & 15) * 16 + (x & 15)];
  }
  getBiomeDef(x, z) { return BiomeById[this.getBiome(x, z)] ?? BiomeById[0]; }

  setBlock(x, y, z, v, flags = SB_ALL) {
    if (y < MIN_Y || y >= MAX_Y) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (c === undefined || c.state < CS_TERRAIN) return false;
    const old = c.getLocal(x & 15, y, z & 15);
    if (old === v) return false;
    c.setLocal(x & 15, y, z & 15, v);
    if (flags & SB_SAVE) c.modified = true;
    if ((old & ID_MASK) !== (v & ID_MASK)) {
      const be = c.blockEntities.get(beKey(x, y, z));
      if (be && !(BlockById[v & ID_MASK].interact === BlockById[old & ID_MASK].interact && be.keep)) {
        c.blockEntities.delete(beKey(x, y, z));
        this.behavior?.onBlockEntityRemoved?.(x, y, z, be);
      }
    }
    if ((flags & SB_LIGHT) && c.state >= CS_LIT) this.light.onBlockChanged(x, y, z, old, v);
    if (flags & SB_MESH) this.markDirtyAt(x, y, z);
    if (flags & SB_NOTIFY && this.behavior) this.behavior.onBlockChanged(x, y, z, old, v);
    return true;
  }

  markDirtyAt(x, y, z) {
    const lx = x & 15, lz = z & 15, ly = (y - MIN_Y) & 15;
    this.markSectionDirty(x >> 4, (y - MIN_Y) >> 4, z >> 4);
    if (lx === 0) this.markSectionDirty((x >> 4) - 1, (y - MIN_Y) >> 4, z >> 4);
    if (lx === 15) this.markSectionDirty((x >> 4) + 1, (y - MIN_Y) >> 4, z >> 4);
    if (lz === 0) this.markSectionDirty(x >> 4, (y - MIN_Y) >> 4, (z >> 4) - 1);
    if (lz === 15) this.markSectionDirty(x >> 4, (y - MIN_Y) >> 4, (z >> 4) + 1);
    if (ly === 0) this.markSectionDirty(x >> 4, ((y - MIN_Y) >> 4) - 1, z >> 4);
    if (ly === 15) this.markSectionDirty(x >> 4, ((y - MIN_Y) >> 4) + 1, z >> 4);
    // diagonal neighbours affect AO / smooth light: cheap to include corners
    if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) {
      this.markSectionDirty((x >> 4) + (lx === 0 ? -1 : 1), (y - MIN_Y) >> 4, (z >> 4) + (lz === 0 ? -1 : 1));
    }
  }

  markSectionDirty(cx, si, cz) {
    if (si < 0 || si >= SECTION_COUNT) return;
    const c = this.getChunk(cx, cz);
    if (!c || c.state < CS_LIT) return;
    c.dirty.add(si);
    this.dirtyChunks.add(c);
  }

  markChunkDirty(c) {
    for (let i = 0; i < SECTION_COUNT; i++) c.dirty.add(i);
    this.dirtyChunks.add(c);
  }

  // ---------- block entities ----------
  getBlockEntity(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.blockEntities.get(beKey(x, y, z)) : undefined;
  }
  setBlockEntity(x, y, z, be) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    be.x = x; be.y = y; be.z = z;
    c.blockEntities.set(beKey(x, y, z), be);
    c.modified = true;
  }

  // ---------- collision ----------
  // Collect collision boxes (world space) intersecting the AABB
  getCollisions(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    out.length = 0;
    const x0 = Math.floor(minX) - 1, x1 = Math.floor(maxX) + 1;
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY) + 1;
    const z0 = Math.floor(minZ) - 1, z1 = Math.floor(maxZ) + 1;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const c = this.getChunk(x >> 4, z >> 4);
      const loaded = c !== undefined && c.state >= CS_TERRAIN;
      for (let y = y0; y <= y1; y++) {
        if (!loaded) { // unloaded chunks are solid walls so nothing falls out of the world
          if (y >= MIN_Y && y < MAX_Y) out.push([x, y, z, x + 1, y + 1, z + 1]);
          continue;
        }
        if (y < MIN_Y) continue;
        const v = c.getLocal(x & 15, y, z & 15);
        if (v === 0) continue;
        const def = BlockById[v & ID_MASK];
        if (!def.solid) continue;
        if (def.render === 'cube') { out.push([x, y, z, x + 1, y + 1, z + 1]); continue; }
        const boxes = getCollisionBoxes(def, v >>> 12, (dx, dy, dz) => this.getBlock(x + dx, y + dy, z + dz));
        for (const b of boxes) {
          const bx0 = x + b[0], by0 = y + b[1], bz0 = z + b[2], bx1 = x + b[3], by1 = y + b[4], bz1 = z + b[5];
          if (bx1 > minX - 1 && bx0 < maxX + 1 && by1 > minY - 1 && by0 < maxY + 1 && bz1 > minZ - 1 && bz0 < maxZ + 1) {
            out.push([bx0, by0, bz0, bx1, by1, bz1]);
          }
        }
      }
    }
    return out;
  }

  // Is any liquid of the given kind (1 water, 2 lava) inside the AABB? Returns fluid surface info.
  containsLiquid(minX, minY, minZ, maxX, maxY, maxZ, kind) {
    for (let x = Math.floor(minX); x < Math.ceil(maxX); x++)
      for (let y = Math.floor(minY); y < Math.ceil(maxY); y++)
        for (let z = Math.floor(minZ); z < Math.ceil(maxZ); z++) {
          const v = this.getBlock(x, y, z);
          const def = BlockById[v & ID_MASK];
          if (!def.liquid || (kind === 1 && def.liquid !== 'water') || (kind === 2 && def.liquid !== 'lava')) {
            if (!(kind === 1 && def.waterlogged)) continue;
          }
          const h = y + fluidHeight(v);
          if (h >= minY) return true;
        }
    return false;
  }

  // ---------- time ----------
  // Minecraft celestial angle (0..1), 0 = noon
  celestialAngle(partial = 0) {
    const t = (this.dayTime + partial) / DAY_LENGTH - 0.25;
    const d = t - Math.floor(t);
    const e = 0.5 - Math.cos(d * Math.PI) / 2;
    return (d * 2 + e) / 3;
  }
  // 0 = full daylight; 11 = darkest night (Minecraft's skyDarken)
  skyDarken() {
    const a = this.celestialAngle();
    let f = 1 - (Math.cos(a * Math.PI * 2) * 2 + 0.5);
    f = Math.min(1, Math.max(0, f));
    f = 1 - f;
    f *= 1 - this.rain * 5 / 16;
    f *= 1 - this.thunder * 5 / 16;
    f = 1 - f;
    return Math.round(f * 11);
  }
  isNight() { const sd = this.skyDarken(); return sd >= 4; }
  moonPhase() { return Math.floor(this.time / DAY_LENGTH) % 8; }

  // ---------- scheduled ticks ----------
  scheduleTick(x, y, z, delay, id = null) {
    const k = `${x},${y},${z}`;
    const due = this.time + delay;
    const e = this.scheduled.get(k);
    if (e && e.due <= due) return;
    this.scheduled.set(k, { x, y, z, due, id });
  }

  tickScheduled() {
    if (this.scheduled.size === 0) return;
    const due = [];
    for (const [k, e] of this.scheduled) if (e.due <= this.time) { due.push(e); this.scheduled.delete(k); }
    due.sort((a, b) => a.due - b.due);
    let n = 0;
    for (const e of due) {
      if (!this.isLoaded(e.x, e.z)) continue;
      this.behavior?.scheduledTick(e.x, e.y, e.z, this.getBlock(e.x, e.y, e.z));
      if (++n > 4000) break; // safety valve
    }
  }

  randomTicks(px, pz, radiusChunks = 8) {
    const speed = this.gamerules.randomTickSpeed;
    if (speed <= 0 || !this.behavior) return;
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    for (let cx = pcx - radiusChunks; cx <= pcx + radiusChunks; cx++) {
      for (let cz = pcz - radiusChunks; cz <= pcz + radiusChunks; cz++) {
        const c = this.getChunk(cx, cz);
        if (!c || c.state < CS_LIT) continue;
        for (let si = 0; si < SECTION_COUNT; si++) {
          const s = c.sections[si];
          if (!s) continue;
          for (let i = 0; i < speed; i++) {
            const r = (Math.random() * 4096) | 0;
            const v = s[r];
            if (v === 0) continue;
            const def = BlockById[v & ID_MASK];
            if (!def.randomTick) continue;
            this.behavior.randomTick((cx << 4) + (r & 15), MIN_Y + si * 16 + (r >> 8), (cz << 4) + ((r >> 4) & 15), v, def);
          }
        }
      }
    }
  }

  tickTime() {
    this.time++;
    if (this.gamerules.doDaylightCycle) this.dayTime = (this.dayTime + 1) % DAY_LENGTH;
    // weather
    if (this.gamerules.doWeatherCycle) {
      if (--this.weatherTimer <= 0) {
        this.raining = !this.raining;
        this.thundering = this.raining && Math.random() < 0.3;
        this.weatherTimer = this.raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
      }
    }
    this.rain += ((this.raining ? 1 : 0) - this.rain) * 0.01;
    this.thunder += ((this.thundering ? 1 : 0) - this.thunder) * 0.01;
    if (this.rain < 0.001) this.rain = 0;
  }

  // ---------- chunk streaming ----------
  // Called every frame. Requests chunks near the player, decorates, lights, unloads far chunks.
  update(px, pz, renderDistance, budgetMs = 6) {
    const t0 = performance.now();
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    this.loadRadius = renderDistance;
    const R = renderDistance + 2;
    // request missing chunks in rings (closest first)
    let requested = 0;
    const maxInFlight = this.generator ? this.generator.capacity : 4;
    outer:
    for (let r = 0; r <= R; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (this.chunks.has(key)) continue;
          if (this.pendingLoads >= maxInFlight) break outer;
          const c = new Chunk(cx, cz);
          this.chunks.set(key, c);
          this.requestChunk(c);
          if (++requested > 8) break outer;
        }
      }
    }
    // decorate + light (closest first)
    const list = [];
    for (const c of this.chunks.values()) {
      if (c.state === CS_TERRAIN || c.state === CS_DECORATED) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        list.push([d, c]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [d, c] of list) {
      if (performance.now() - t0 > budgetMs) break;
      if (c.state === CS_TERRAIN && d <= R - 1 && this.neighboursAtLeast(c, CS_TERRAIN)) {
        const t1 = performance.now();
        this.decorate(c);
        this.stats.decoTime += performance.now() - t1;
      }
      if (c.state === CS_DECORATED && d <= R - 2 && this.neighboursAtLeast(c, CS_DECORATED)) {
        const t1 = performance.now();
        this.light.lightChunk(c);
        c.state = CS_LIT;
        this.stats.lightTime += performance.now() - t1;
        // this chunk and its neighbours may now be meshable
        this.markChunkDirty(c);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const n = this.getChunk(c.cx + dx, c.cz + dz);
          if (n && n !== c && n.state >= CS_LIT) this.markChunkDirty(n);
        }
        this.entityHooks?.onChunkLit?.(c);
      }
    }
    // unload far chunks
    const U = R + 2;
    for (const c of this.chunks.values()) {
      if (Math.abs(c.cx - pcx) > U || Math.abs(c.cz - pcz) > U) {
        if (c.state === CS_EMPTY) continue; // still loading, drop when it arrives
        this.unloadChunk(c);
      }
    }
  }

  neighboursAtLeast(c, state) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n || n.state < state) return false;
    }
    return true;
  }

  isMeshable(c) {
    if (c.state < CS_LIT) return false;
    return this.neighboursAtLeast(c, CS_LIT);
  }

  async requestChunk(c) {
    this.pendingLoads++;
    let data = null;
    try {
      if (this.storage && this.id != null) data = await this.storage.loadChunk(this.id, c.cx, c.cz);
    } catch (e) { console.warn('chunk load failed', e); }
    if (data) {
      this.pendingLoads--;
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return;
      applySavedChunk(c, data);
      c.fromSave = true;
      c.state = CS_DECORATED; // saved blocks already contain all features
      this.entityHooks?.onChunkLoaded?.(c, data);
      return;
    }
    this.generator.generate(c.cx, c.cz).then((res) => {
      this.pendingLoads--;
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return;
      c.sections = res.sections;
      c.biomes = res.biomes;
      c.features = res.features || [];
      c.state = CS_TERRAIN;
      c.fresh = true;
      this.entityHooks?.onChunkGenerated?.(c);
    }, (err) => {
      this.pendingLoads--;
      console.error('generation failed', err);
      this.chunks.delete(chunkKey(c.cx, c.cz));
    });
  }

  // Pull features from the 3x3 source chunks, writing only into this chunk.
  decorate(c) {
    const bx0 = c.cx << 4, bz0 = c.cz << 4, bx1 = bx0 + 15, bz1 = bz0 + 15;
    const access = {
      getBlock: (x, y, z) => this.getBlock(x, y, z),
      setBlock: (x, y, z, v) => {
        if (x < bx0 || x > bx1 || z < bz0 || z > bz1 || y < MIN_Y || y >= MAX_Y) return;
        c.setLocal(x & 15, y, z & 15, v);
      },
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const src = this.getChunk(c.cx + dx, c.cz + dz);
        if (!src || !src.features) continue;
        for (const f of src.features) {
          const r = f.r ?? 12;
          if (f.x + r < bx0 || f.x - r > bx1 || f.z + r < bz0 || f.z - r > bz1) continue;
          try { this.generator.placeFeature(access, f); } catch (e) { console.warn('feature failed', f, e); }
        }
      }
    }
    c.state = CS_DECORATED;
  }

  unloadChunk(c) {
    if (c.modified && this.storage && this.id != null) {
      this.storage.saveChunk(this.id, c, this.entityHooks?.collectChunkEntities?.(c));
    }
    this.entityHooks?.onChunkUnload?.(c);
    this.chunks.delete(c.key);
    this.dirtyChunks.delete(c);
    if (this._lastChunk === c) this._lastChunk = null;
    if (this.onChunkUnload) this.onChunkUnload(c);
  }

  async saveAll() {
    if (!this.storage || this.id == null) return;
    const jobs = [];
    for (const c of this.chunks.values()) {
      if (c.modified && c.state >= CS_DECORATED) {
        jobs.push(this.storage.saveChunk(this.id, c, this.entityHooks?.collectChunkEntities?.(c)));
        c.modified = false;
      }
    }
    await Promise.all(jobs);
  }
}

export function beKey(x, y, z) { return `${x & 15},${y},${z & 15}`; }

// liquid surface height within its block (0..1)
export function fluidHeight(v) {
  const def = BlockById[v & ID_MASK];
  if (!def.liquid) return def.waterlogged ? 1 : 0;
  const meta = v >>> 12;
  if (meta >= 8) return 1;
  return (8 - meta) / 9;
}

export function applySavedChunk(c, data) {
  c.sections = data.sections;
  c.biomes = data.biomes;
  c.features = data.features || [];
  c.blockEntities = new Map(data.blockEntities || []);
}

export { CS_EMPTY, CS_TERRAIN, CS_DECORATED, CS_LIT, packBlock, blockId, IS_OPAQUE, LIGHT_FILTER, B };
