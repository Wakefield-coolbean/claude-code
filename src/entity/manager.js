// Entity list: ticking, item pickup, entity pushing, natural spawning and despawning.
import { ID_MASK, MIN_Y } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';
import { BiomeById } from '../registry/biomes.js';
import { MOB_TYPES, resetPathBudget } from './mobs.js';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt, Arrow, ThrownItem } from './objects.js';
import { ItemStack } from '../game/inventory.js';
import { CS_LIT } from '../world/chunk.js';

const OBJECT_TYPES = { item: ItemEntity, xp_orb: XpOrb, falling_block: FallingBlock, tnt: PrimedTnt, arrow: Arrow, thrown: ThrownItem };

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnTimer = 0;
  }
  get world() { return this.game.world; }

  add(e) { this.list.push(e); return e; }

  clear() { this.list = this.list.filter((e) => e.isPlayer); }

  create(type, data) {
    let e;
    if (MOB_TYPES[type]) e = new MOB_TYPES[type](this.world);
    else if (OBJECT_TYPES[type]) {
      if (type === 'item') e = new ItemEntity(this.world, null);
      else if (type === 'xp_orb') e = new XpOrb(this.world, 1);
      else if (type === 'falling_block') e = new FallingBlock(this.world, 0);
      else if (type === 'tnt') e = new PrimedTnt(this.world);
      else if (type === 'arrow') e = new Arrow(this.world, null);
      else if (type === 'thrown') e = new ThrownItem(this.world, 'snowball', null);
    }
    if (!e) return null;
    if (data) e.deserialize(data);
    return e;
  }

  tick() {
    resetPathBudget();
    const p = this.game.player;
    const w = this.world;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.removed) continue;
      // freeze entities in unloaded chunks
      if (!e.isPlayer && !w.isLoaded(Math.floor(e.x), Math.floor(e.z))) continue;
      e.tick();
    }
    // item / xp pickup
    if (p && !p.dead && !p.spectator) {
      const pb = p.aabb();
      for (const e of this.list) {
        if (e.removed) continue;
        if (e.isItem && !e.pickupAnim && e.pickupDelay === 0) {
          const b = e.aabb();
          if (b[0] < pb[3] + 1 && b[3] > pb[0] - 1 && b[1] < pb[4] + 0.5 && b[4] > pb[1] - 0.5 && b[2] < pb[5] + 1 && b[5] > pb[2] - 1) {
            const before = e.stack.count;
            const left = p.inventory.add(e.stack);
            if (left < before) {
              this.game.sound.play('random.pop', { x: e.x, y: e.y, z: e.z, volume: 0.2, pitch: ((Math.random() - Math.random()) * 0.7 + 1) * 2 });
              if (left <= 0) e.pickupAnim = { t: 0, target: p };
            }
          }
        } else if (e.isXpOrb && (p.xpPickupDelay ?? 0) <= 0) {
          const b = e.aabb();
          if (b[0] < pb[3] && b[3] > pb[0] && b[1] < pb[4] && b[4] > pb[1] && b[2] < pb[5] && b[5] > pb[2]) {
            p.xpPickupDelay = 2;
            p.giveXp(e.value);
            // mending
            this.game.sound.play('random.orb', { volume: 0.1, pitch: 0.5 * ((Math.random() - Math.random()) * 0.7 + 1.8) });
            e.remove();
          }
        } else if (e.isArrow && e.inGround && e.pickup !== 'disallowed' && e.shake <= 0) {
          const b = e.aabb();
          if (b[0] < pb[3] + 1 && b[3] > pb[0] - 1 && b[1] < pb[4] + 0.5 && b[4] > pb[1] - 0.5 && b[2] < pb[5] + 1 && b[5] > pb[2] - 1) {
            if (e.pickup === 'creative' || p.inventory.add(ItemStack.of('arrow')) === 0) {
              this.game.sound.play('random.pop', { volume: 0.2, pitch: ((Math.random() - Math.random()) * 0.7 + 1) * 2 });
              e.remove();
            }
          }
        }
      }
      if (p.xpPickupDelay > 0) p.xpPickupDelay--;
    }
    // push living entities apart
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.isLiving || a.removed || a.dead || a.spectator || a.sleeping) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.isLiving || b.removed || b.dead || b.spectator) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const r = (a.width + b.width) / 2;
        if (Math.abs(dx) >= r || Math.abs(dz) >= r) continue;
        if (a.y + a.height < b.y || b.y + b.height < a.y) continue;
        let d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d < 0.01) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = 0.5; }
        d = Math.sqrt(d);
        dx /= d; dz /= d;
        let f = 1 / d; if (f > 1) f = 1;
        dx *= f * 0.05; dz *= f * 0.05;
        a.vx -= dx; a.vz -= dz;
        b.vx += dx; b.vz += dz;
      }
    }
    // remove dead entries
    this.list = this.list.filter((e) => !e.removed || e.isPlayer);
    this.despawn();
    if (++this.spawnTimer >= 5) { this.spawnTimer = 0; this.naturalSpawn(); }
  }

  // ---------- spawning ----------
  countHostile() { let n = 0; for (const e of this.list) if ((e.hostile || e.nether) && !e.removed) n++; return n; }
  countPassive() { let n = 0; for (const e of this.list) if (e.isLiving && !e.hostile && !e.isPlayer && !e.removed) n++; return n; }

  naturalSpawn() {
    const w = this.world, p = this.game.player;
    if (!p || !w.gamerules.doMobSpawning) return;
    if (w.difficulty === 0) {
      for (const e of this.list) if (e.hostile) e.remove();
    } else if (this.countHostile() < 40) {
      // several attempts per call
      for (let attempt = 0; attempt < 3; attempt++) {
        if (w.dimension === 'nether') this.trySpawnNether(p); else this.trySpawnHostile(p);
      }
    }
    // rare passive respawn in grassy chunks
    if (w.dimension === 'overworld' && Math.random() < 0.004 && this.countPassive() < 12) this.trySpawnPassiveNear(p);
  }

  // Nether spawn tables per biome (weight, type, [min, max] group)
  static NETHER_SPAWNS = {
    nether_wastes: [[50, 'ghast', 4, 4], [100, 'zombified_piglin', 4, 4], [2, 'magma_cube', 4, 4], [1, 'enderman', 4, 4]],
    crimson_forest: [[1, 'zombified_piglin', 2, 4]],
    warped_forest: [[1, 'enderman', 4, 4]],
    soul_sand_valley: [[20, 'skeleton', 5, 5], [50, 'ghast', 4, 4], [1, 'enderman', 4, 4]],
    basalt_deltas: [[40, 'ghast', 1, 1], [100, 'magma_cube', 2, 5]],
  };

  trySpawnNether(p) {
    const w = this.world;
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 72;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    if (!w.isLoaded(x, z)) return;
    let fy = 1 + Math.floor(Math.random() * 126);
    while (fy > 1 && !BlockById[w.getBlock(x, fy - 1, z) & ID_MASK].solid) fy--;
    if (fy <= 1 || fy >= 127) return;
    if (Math.hypot(x + 0.5 - p.x, fy - p.y, z + 0.5 - p.z) < 24) return;
    const biome = BiomeById[w.getBiome(x, z)];
    const table = EntityManager.NETHER_SPAWNS[biome?.name] ?? EntityManager.NETHER_SPAWNS.nether_wastes;
    let r = Math.random() * table.reduce((a, e) => a + e[0], 0), pick = table[0];
    for (const e of table) { if (r < e[0]) { pick = e; break; } r -= e[0]; }
    const [, type, gmin, gmax] = pick;
    const below = w.getBlock(x, fy - 1, z) & ID_MASK;
    if (below === B.bedrock || below === B.nether_portal) return;
    // per-type spawn rules
    if (type === 'ghast' && Math.random() >= 1 / 20) return;
    if (type === 'zombified_piglin' && below === B.nether_wart_block) return;
    if (type === 'skeleton' || type === 'enderman') {
      const raw = w.getBlockLight(x, fy, z);
      if (raw > Math.floor(Math.random() * 8)) return;
    }
    const h = type === 'ghast' ? 4 : type === 'enderman' ? 3 : 2;
    const n = gmin + Math.floor(Math.random() * (gmax - gmin + 1));
    let spawned = 0;
    for (let i = 0; i < n && spawned < (type === 'ghast' ? 1 : 4); i++) {
      const sx = x + (i === 0 ? 0 : Math.floor(Math.random() * 7) - 3), sz = z + (i === 0 ? 0 : Math.floor(Math.random() * 7) - 3);
      let sy = fy;
      if (i > 0) { while (sy > 1 && !BlockById[w.getBlock(sx, sy - 1, sz) & ID_MASK].solid) sy--; }
      if (!this.validSpawn(sx, sy, sz, h)) continue;
      if (type === 'ghast' && !this.validSpawnWide(sx, sy, sz)) continue;
      const m = this.game.spawnMob(type, sx + 0.5, sy, sz + 0.5);
      if (m) spawned++;
    }
  }

  trySpawnHostile(p) {
    const w = this.world;
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 72;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    if (!w.isLoaded(x, z)) return;
    const top = w.getTopSolidY(x, z);
    const y = MIN_Y + 1 + Math.floor(Math.random() * (top + 2 - MIN_Y));
    // find floor at/under y
    let fy = y;
    while (fy > MIN_Y && !BlockById[w.getBlock(x, fy - 1, z) & ID_MASK].solid) fy--;
    if (!this.validSpawn(x, fy, z, 2)) return;
    if (Math.hypot(x + 0.5 - p.x, fy - p.y, z + 0.5 - p.z) < 24) return;
    // Java 1.18 monster light rules
    const blockLight = w.getBlockLight(x, fy, z);
    if (blockLight > 0) return;
    const sky = w.getSkyLight(x, fy, z);
    if (sky > Math.floor(Math.random() * 32)) return;
    const raw = Math.max(sky - w.skyDarken(), blockLight);
    if (raw > Math.floor(Math.random() * 8)) return;
    const below = BlockById[w.getBlock(x, fy - 1, z) & ID_MASK];
    if (below.name === 'bedrock' || !below.opaque) return;
    const r = Math.random() * 410;
    const type = r < 100 ? 'zombie' : r < 200 ? 'skeleton' : r < 300 ? 'spider' : r < 400 ? 'creeper' : 'enderman';
    const n = type === 'enderman' ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const sx = x + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2), sz = z + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
      let sy = fy;
      if (i > 0) { while (sy > MIN_Y && !BlockById[w.getBlock(sx, sy - 1, sz) & ID_MASK].solid) sy--; }
      const h = type === 'enderman' ? 3 : type === 'spider' ? 1 : 2;
      if (i > 0 && (!this.validSpawn(sx, sy, sz, h) || w.getBlockLight(sx, sy, sz) > 0)) continue;
      if (type === 'spider' && !this.validSpawnWide(sx, sy, sz)) continue;
      this.game.spawnMob(type, sx + 0.5, sy, sz + 0.5);
    }
  }

  validSpawn(x, y, z, h) {
    const w = this.world;
    const below = BlockById[w.getBlock(x, y - 1, z) & ID_MASK];
    if (!below.solid) return false;
    for (let i = 0; i < h; i++) {
      const d = BlockById[w.getBlock(x, y + i, z) & ID_MASK];
      if (d.solid || d.liquid || d.name === 'fire' || d.name === 'cobweb') return false;
    }
    return true;
  }
  validSpawnWide(x, y, z) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!this.validSpawn(x + dx, y, z + dz, 1)) return false;
    return true;
  }

  trySpawnPassiveNear(p) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 32 + Math.random() * 48;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    this.spawnAnimalGroup(x, z);
  }

  spawnAnimalGroup(x, z, rand = Math.random) {
    const w = this.world;
    if (!w.isLoaded(x, z) && !w.getChunk(x >> 4, z >> 4)) return;
    const biome = BiomeById[w.getBiome(x, z)];
    if (!biome || /ocean|river|beach|desert|peaks|slopes|badlands|mushroom/.test(biome.name)) return;
    const y = w.getTopSolidY(x, z) + 1;
    if (BlockById[w.getBlock(x, y - 1, z) & ID_MASK].id !== B.grass_block) return;
    if (w.getRawBrightness(x, y, z, 0) < 9) return;
    const types = ['sheep', 'pig', 'chicken', 'cow'];
    const weights = [12, 10, 10, 8];
    let r = rand() * 40, type = 'sheep';
    for (let i = 0; i < 4; i++) { if (r < weights[i]) { type = types[i]; break; } r -= weights[i]; }
    const n = type === 'chicken' ? 2 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const sx = x + Math.floor(rand() * 7) - 3, sz = z + Math.floor(rand() * 7) - 3;
      const sy = w.getTopSolidY(sx, sz) + 1;
      if (BlockById[w.getBlock(sx, sy - 1, sz) & ID_MASK].id !== B.grass_block) continue;
      if (!this.validSpawn(sx, sy, sz, 2)) continue;
      const m = this.game.spawnMob(type, sx + 0.5, sy, sz + 0.5);
      if (m && rand() < 0.1) m.setBaby(true);
    }
  }

  // called when a freshly generated chunk becomes lit
  onChunkLit(c) {
    if (!c.fresh || c.animalsSpawned) return;
    c.animalsSpawned = true;
    if (Math.random() < 0.1) this.spawnAnimalGroup((c.cx << 4) + 8, (c.cz << 4) + 8);
  }

  despawn() {
    const p = this.game.player;
    if (!p) return;
    for (const e of this.list) {
      if (!(e.hostile || e.nether) || e.persistent || e.removed) continue;
      const d = e.distanceTo(p);
      if (d > 128) e.remove();
      else if (d > 32 && Math.random() < 1 / 800) e.remove();
    }
  }

  // ---------- persistence per chunk ----------
  collectChunkEntities(c) {
    const out = [];
    for (const e of this.list) {
      if (e.isPlayer || e.removed) continue;
      if ((Math.floor(e.x) >> 4) !== c.cx || (Math.floor(e.z) >> 4) !== c.cz) continue;
      if (e.hostile && !e.persistent) continue;
      if (e.type === 'thrown') continue;
      const d = e.serialize();
      if (d) out.push(d);
    }
    return out;
  }
  onChunkUnload(c) {
    for (const e of this.list) {
      if (e.isPlayer) continue;
      if ((Math.floor(e.x) >> 4) === c.cx && (Math.floor(e.z) >> 4) === c.cz) e.remove();
    }
  }
  loadChunkEntities(list) {
    for (const d of list || []) {
      const e = this.create(d.type, d);
      if (e && !e.removed) this.add(e);
    }
  }
}

export { CS_LIT };
