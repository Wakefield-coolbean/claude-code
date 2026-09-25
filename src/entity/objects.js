// Non-living entities: dropped items, xp orbs, falling blocks, primed TNT, arrows and thrown items.
import { Entity } from './entity.js';
import { ID_MASK, packBlock } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';
import { ItemStack } from '../game/inventory.js';
import { rayBox } from '../game/raycast.js';
import { raycastBlocks } from '../game/raycast.js';

export class ItemEntity extends Entity {
  constructor(world, stack) {
    super(world, 'item');
    this.isItem = true;
    this.stack = stack;
    this.width = 0.25; this.height = 0.25;
    this.pickupDelay = 10;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.lifespan = 6000;
    this.health = 5;
    this.pickupAnim = null;
    this.eyeHeight = 0.125;
  }
  tick() {
    this.baseTick();
    if (this.pickupAnim) {
      this.pickupAnim.t++;
      if (this.pickupAnim.t >= 3) this.remove();
      return;
    }
    if (this.pickupDelay > 0 && this.pickupDelay !== 32767) this.pickupDelay--;
    if (this.inWater && this.waterHeight > 0.1) {
      this.vx *= 0.99; this.vz *= 0.99;
      this.vy += this.vy < 0.06 ? 5e-4 : 0;
    } else if (this.inLava) {
      this.vx *= 0.95; this.vz *= 0.95; this.vy += this.vy < 0.06 ? 5e-4 : 0;
      this.world.game?.sound?.play('random.fizz', { x: this.x, y: this.y, z: this.z, volume: 0.4, pitch: 2 + Math.random() * 0.4 });
      this.remove();
      return;
    } else this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) f = (BlockById[this.blockBelow() & ID_MASK].slip ?? 0.6) * 0.98;
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.5;
    if (this.age % 20 === 0) this.tryMerge();
    if (this.age >= this.lifespan) this.remove();
    // cactus / fire destroy items
    const def = BlockById[this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) & ID_MASK];
    if (def.name === 'fire' || def.name === 'cactus') this.remove();
  }
  tryMerge() {
    if (!this.stack || this.stack.count >= this.stack.maxStack) return;
    for (const e of this.world.game?.entities?.list ?? []) {
      if (e === this || !e.isItem || e.removed || e.pickupAnim) continue;
      if (Math.abs(e.x - this.x) > 0.5 || Math.abs(e.y - this.y) > 0.5 || Math.abs(e.z - this.z) > 0.5) continue;
      if (!e.stack.canStackWith(this.stack)) continue;
      const n = Math.min(e.stack.count, this.stack.maxStack - this.stack.count);
      if (n <= 0) continue;
      this.stack.count += n;
      e.stack.count -= n;
      this.pickupDelay = Math.max(this.pickupDelay, e.pickupDelay);
      this.age = Math.min(this.age, e.age);
      if (e.stack.count <= 0) e.remove();
    }
  }
  hurt(source, amount) {
    if (source.type === 'explosion' || source.type === 'fire' || source.type === 'lava') { this.health -= amount; if (this.health <= 0) this.remove(); return true; }
    return false;
  }
  serialize() { return { ...super.serialize(), stack: this.stack.serialize(), pickupDelay: this.pickupDelay }; }
  deserialize(d) { super.deserialize(d); this.stack = ItemStack.deserialize(d.stack); this.pickupDelay = d.pickupDelay ?? 0; if (!this.stack) this.remove(); }
}

export class XpOrb extends Entity {
  constructor(world, value) {
    super(world, 'xp_orb');
    this.isXpOrb = true;
    this.value = value;
    this.width = 0.5; this.height = 0.5;
    this.lifespan = 6000;
    this.eyeHeight = 0.25;
  }
  static sizeIndex(v) {
    const t = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3];
    for (let i = 0; i < t.length; i++) if (v >= t[i]) return 10 - i;
    return 0;
  }
  tick() {
    this.baseTick();
    if (this.inLava) { this.remove(); return; }
    this.vy -= 0.03;
    const p = this.world.game?.player;
    if (p && !p.dead && !p.spectator) {
      const dx = p.x - this.x, dy = p.y + p.eyeHeight / 2 - this.y, dz = p.z - this.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 64) {
        const d = Math.sqrt(d2);
        const f = 1 - d / 8;
        const k = f * f * 0.1 / Math.max(d, 1e-4);
        this.vx += dx * k; this.vy += dy * k; this.vz += dz * k;
      }
    }
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) f = (BlockById[this.blockBelow() & ID_MASK].slip ?? 0.6) * 0.98;
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.9;
    if (this.age >= this.lifespan) this.remove();
  }
  serialize() { return { ...super.serialize(), value: this.value }; }
  deserialize(d) { super.deserialize(d); this.value = d.value; }
}

export class FallingBlock extends Entity {
  constructor(world, value) {
    super(world, 'falling_block');
    this.value = value;
    this.width = 0.98; this.height = 0.98;
    this.time = 0;
    this.eyeHeight = 0.49;
  }
  tick() {
    this.baseTick();
    this.time++;
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    const w = this.world;
    if (this.onGround) {
      const x = Math.floor(this.x), y = Math.floor(this.y + 0.01), z = Math.floor(this.z);
      const cur = BlockById[w.getBlock(x, y, z) & ID_MASK];
      this.remove();
      if (cur.replaceable || cur.liquid || cur.id === 0) {
        if (cur.render === 'cross') w.game?.dropBlockItems?.(x, y, z, w.getBlock(x, y, z), null);
        w.setBlock(x, y, z, this.value);
        w.game?.sound?.playBlock('place', BlockById[this.value & ID_MASK].sound, x + 0.5, y + 0.5, z + 0.5);
      } else {
        w.game?.spawnItem?.(this.x, this.y + 0.5, this.z, new ItemStack(this.value & ID_MASK, 1));
      }
    } else if (this.time > 600 || this.y < -128) this.remove();
  }
  serialize() { return { ...super.serialize(), value: this.value }; }
  deserialize(d) { super.deserialize(d); this.value = d.value; }
}

export class PrimedTnt extends Entity {
  constructor(world, fuse = 80, owner = null) {
    super(world, 'tnt');
    this.isTnt = true;
    this.fuse = fuse;
    this.owner = owner;
    this.width = 0.98; this.height = 0.98;
    this.eyeHeight = 0.15;
    const a = Math.random() * Math.PI * 2;
    this.vx = -Math.sin(a) * 0.02; this.vy = 0.2; this.vz = -Math.cos(a) * 0.02;
    this.blocksPlacement = true;
  }
  tick() {
    this.baseTick();
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; this.vy *= -0.5; }
    this.fuse--;
    if (this.fuse <= 0) {
      this.remove();
      this.world.game?.explode(this.x, this.y + 0.0625 * 1, this.z, 4, { source: this });
    } else if (this.age % 2 === 0) this.world.game?.fx?.smokeAt?.(this.x, this.y + 0.5, this.z);
  }
  serialize() { return { ...super.serialize(), fuse: this.fuse }; }
  deserialize(d) { super.deserialize(d); this.fuse = d.fuse; }
}

// Arrows and thrown items share projectile physics
export class Projectile extends Entity {
  constructor(world, type, owner) {
    super(world, type);
    this.owner = owner;
    this.width = 0.25; this.height = 0.25;
    this.eyeHeight = 0.13;
    this.gravityP = 0.03;
    this.dragP = 0.99;
    this.inGround = false;
    this.leftOwner = false;
  }
  shoot(dx, dy, dz, velocity, inaccuracy) {
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.0075 * inaccuracy;
    dx += g(); dy += g(); dz += g();
    this.vx = dx * velocity; this.vy = dy * velocity; this.vz = dz * velocity;
    this.updateRotation();
    this.pyaw = this.yaw; this.ppitch = this.pitch;
  }
  updateRotation() {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(-this.vx, -this.vz);
    this.pitch = Math.atan2(this.vy, h);
  }
  // returns true when it hit something
  stepProjectile() {
    const w = this.world;
    const sx = this.x, sy = this.y + this.height / 2, sz = this.z;
    const len = Math.hypot(this.vx, this.vy, this.vz);
    if (len < 1e-6) return false;
    const dx = this.vx / len, dy = this.vy / len, dz = this.vz / len;
    const bh = raycastBlocks(w, sx, sy, sz, dx, dy, dz, len);
    let hitDist = bh ? bh.dist : len;
    // entities
    let target = null;
    for (const e of w.game?.entities?.list ?? []) {
      if (!e.isLiving || e.dead || e.removed || e === this) continue;
      if (e === this.owner && !this.leftOwner) continue;
      if (e.spectator) continue;
      const b = e.aabb(0.3);
      const r = rayBox(sx, sy, sz, dx, dy, dz, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (r && r.t <= hitDist) { hitDist = r.t; target = e; }
    }
    if (this.owner && !this.leftOwner && this.age > 2) {
      const ob = this.owner.aabb(0.5);
      const me = this.aabb();
      if (!(me[0] < ob[3] && me[3] > ob[0] && me[1] < ob[4] && me[4] > ob[1] && me[2] < ob[5] && me[5] > ob[2])) this.leftOwner = true;
    }
    if (target) { this.onHitEntity(target, sx + dx * hitDist, sy + dy * hitDist, sz + dz * hitDist); return true; }
    if (bh) { this.onHitBlock(bh); return true; }
    return false;
  }
  onHitEntity() { this.remove(); }
  onHitBlock() { this.remove(); }
  tick() {
    this.baseTick();
    if (!this.inGround) {
      const hit = this.stepProjectile();
      if (this.removed) return;
      if (!hit || !this.inGround) {
        this.x += this.vx; this.y += this.vy; this.z += this.vz;
      }
      this.updateRotation();
      const drag = this.inWater ? this.waterDrag() : this.dragP;
      this.vx *= drag; this.vy *= drag; this.vz *= drag;
      if (!this.noGravity) this.vy -= this.gravityP;
      if (this.inWater && this.age % 4 === 0) this.world.game?.fx?.bubble?.(this.x, this.y, this.z);
    }
  }
  waterDrag() { return 0.8; }
}

export class Arrow extends Projectile {
  constructor(world, owner) {
    super(world, 'arrow', owner);
    this.isArrow = true;
    this.width = 0.5; this.height = 0.5;
    this.gravityP = 0.05;
    this.baseDamage = 2;
    this.crit = false;
    this.knockbackLevel = 0;
    this.pickup = owner?.isPlayer ? (owner.creative ? 'creative' : 'allowed') : 'disallowed';
    this.inGroundTime = 0;
    this.shake = 0;
    this.stuck = null;
    this.onFire = false;
  }
  waterDrag() { return 0.6; }
  tick() {
    super.tick();
    if (this.shake > 0) this.shake--;
    if (this.inGround) {
      const s = this.stuck;
      if (s && this.world.getBlock(s.x, s.y, s.z) !== s.v) { this.inGround = false; this.vx = this.vy = this.vz = 0; this.vy = -0.05; }
      else if (++this.inGroundTime >= 1200) this.remove();
    } else if (this.crit && this.age % 1 === 0) this.world.game?.fx?.critTrail?.(this);
    if (this.fireTicks > 0 || this.onFire) this.onFire = this.fireTicks > 0;
  }
  onHitEntity(e) {
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    let dmg = Math.ceil(Math.max(0, Math.min(2147483647, speed * this.baseDamage)));
    if (this.crit) dmg = Math.min(dmg + Math.floor(Math.random() * (dmg / 2 + 2)), 2147483647);
    if (this.fireTicks > 0) e.setOnFire?.(5);
    const src = { type: 'arrow', entity: this.owner, pos: [this.x, this.y, this.z], knockback: false };
    if (e.hurt(src, dmg)) {
      // arrow knockback follows arrow direction
      const h = Math.hypot(this.vx, this.vz);
      if (h > 1e-4) e.knockback?.(0.4 + this.knockbackLevel * 0.6, -this.vx / h, -this.vz / h);
      if (this.owner?.isPlayer && e !== this.owner) this.world.game?.sound?.play('random.successful_hit', { volume: 0.18, pitch: 0.45 });
      this.world.game?.sound?.play('random.bowhit', { x: this.x, y: this.y, z: this.z, pitch: 1.2 / (Math.random() * 0.2 + 0.9) });
      this.remove();
      if (e.isPlayer === undefined && this.owner?.isPlayer) e.arrowCount = (e.arrowCount ?? 0) + 1;
    } else {
      // deflected (e.g. shield)
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
      this.yaw += Math.PI;
      if (Math.hypot(this.vx, this.vy, this.vz) < 1e-7) this.remove();
    }
  }
  onHitBlock(hit) {
    this.x = hit.hitX - this.vx * 0.05 / Math.max(1e-4, Math.hypot(this.vx, this.vy, this.vz));
    this.y = hit.hitY - this.height / 2;
    this.z = hit.hitZ;
    this.inGround = true;
    this.shake = 7;
    this.crit = false;
    this.stuck = { x: hit.x, y: hit.y, z: hit.z, v: hit.value };
    this.world.game?.sound?.play('random.bowhit', { x: this.x, y: this.y, z: this.z, pitch: 1.2 / (Math.random() * 0.2 + 0.9) });
    if (BlockById[hit.value & ID_MASK].name === 'tnt' && this.fireTicks > 0) {
      this.world.setBlock(hit.x, hit.y, hit.z, 0);
      this.world.game?.primeTnt(hit.x, hit.y, hit.z, this.owner);
    }
  }
  serialize() { return { ...super.serialize(), inGround: this.inGround, stuck: this.stuck, pickup: this.pickup, t: this.inGroundTime }; }
  deserialize(d) { super.deserialize(d); this.inGround = d.inGround; this.stuck = d.stuck; this.pickup = d.pickup; this.inGroundTime = d.t ?? 0; }
}

export class ThrownItem extends Projectile {
  constructor(world, itemName, owner) {
    super(world, 'thrown', owner);
    this.itemName = itemName;
    this.gravityP = itemName === 'experience_bottle' ? 0.07 : 0.03;
  }
  onHitEntity(e) {
    const g = this.world.game;
    if (this.itemName === 'snowball') e.hurt({ type: 'generic', entity: this.owner, pos: [this.x, this.y, this.z] }, e.type === 'blaze' ? 3 : 0);
    else e.hurt({ type: 'generic', entity: this.owner, pos: [this.x, this.y, this.z] }, 0);
    this.impact(g);
  }
  onHitBlock(hit) { this.x = hit.hitX; this.y = hit.hitY; this.z = hit.hitZ; this.impact(this.world.game); }
  impact(g) {
    this.remove();
    g?.fx?.itemBreak?.(this.x, this.y, this.z, this.itemName);
    if (this.itemName === 'egg' && Math.random() < 0.125) {
      const n = Math.random() < 1 / 32 ? 4 : 1;
      for (let i = 0; i < n; i++) g?.spawnMob('chicken', this.x, this.y, this.z, { baby: true });
    } else if (this.itemName === 'ender_pearl' && this.owner && !this.owner.dead) {
      g?.fx?.portal?.(this.owner.x, this.owner.y, this.owner.z);
      this.owner.setPos(this.x, this.y, this.z);
      this.owner.fallDistance = 0;
      this.owner.hurt({ type: 'fall' }, 5);
      g?.sound?.play('mob.enderman.portal', { x: this.x, y: this.y, z: this.z });
    } else if (this.itemName === 'experience_bottle') {
      g?.sound?.play('random.glass', { x: this.x, y: this.y, z: this.z });
      g?.spawnXp(this.x, this.y, this.z, 3 + Math.floor(Math.random() * 5) + Math.floor(Math.random() * 5));
    }
  }
  serialize() { return { ...super.serialize(), item: this.itemName }; }
  deserialize(d) { super.deserialize(d); this.itemName = d.item; }
}

// ---------- explosions (Minecraft algorithm) ----------
export function blastResistance(def) {
  if (def.resistance !== undefined) return def.resistance;
  if (def.id === B.bedrock) return 3600000;
  if (def.id === B.obsidian) return 1200;
  if (def.liquid) return 100;
  if (def.id === 0) return 0;
  if (def.tool === 'pickaxe') {
    if (def.xp || def.name.endsWith('_ore')) return 3;
    if (def.name.startsWith('deepslate') || def.name.includes('deepslate')) return 6;
    if (def.hardness >= 1.5) return 6;
    return def.hardness;
  }
  if (def.name.endsWith('_log')) return 2;
  if (def.name.endsWith('_planks') || def.shape === 'stairs' || def.shape === 'slab' || def.shape === 'fence') return 3;
  return def.hardness;
}

export function explode(game, cx, cy, cz, power, { source = null, fire = false, breakBlocks = true } = {}) {
  const w = game.world;
  const toBreak = new Map();
  if (breakBlocks && w.gamerules.mobGriefing !== false) {
    const inWater = BlockById[w.getBlock(Math.floor(cx), Math.floor(cy), Math.floor(cz)) & ID_MASK].liquid;
    if (!inWater) {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
        if (!(i === 0 || i === 15 || j === 0 || j === 15 || k === 0 || k === 15)) continue;
        let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        let strength = power * (0.7 + Math.random() * 0.6);
        let x = cx, y = cy, z = cz;
        while (strength > 0) {
          const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
          const v = w.getBlock(bx, by, bz);
          const def = BlockById[v & ID_MASK];
          if (v !== 0) strength -= (blastResistance(def) + 0.3) * 0.3;
          if (strength > 0 && v !== 0 && !def.liquid) toBreak.set(`${bx},${by},${bz}`, [bx, by, bz, v]);
          x += dx * 0.3; y += dy * 0.3; z += dz * 0.3;
          strength -= 0.225;
        }
      }
    }
  }
  // entities
  const r2 = power * 2;
  for (const e of game.entities.list) {
    if (e.removed || e === source) continue;
    const dist = Math.hypot(e.x - cx, e.y - cy, e.z - cz) / r2;
    if (dist > 1) continue;
    let dx = e.x - cx, dy = e.y + (e.eyeHeight ?? 0) - cy, dz = e.z - cz;
    const dl = Math.hypot(dx, dy, dz);
    if (dl === 0) continue;
    dx /= dl; dy /= dl; dz /= dl;
    const exposure = seenPercent(w, cx, cy, cz, e);
    const impact = (1 - dist) * exposure;
    const dmg = Math.floor((impact * impact + impact) / 2 * 7 * r2 + 1);
    if (e.hurt) e.hurt({ type: 'explosion', entity: source?.owner ?? null, pos: [cx, cy, cz], knockback: false }, dmg);
    let kb = impact;
    if (e.isLiving) {
      let bp = 0;
      for (const k of ['head', 'chest', 'legs', 'feet']) bp = Math.max(bp, e.equipment?.[k]?.enchantLevel?.('blast_protection') ?? 0);
      if (bp > 0) kb *= Math.max(0, 1 - bp * 0.15);
    }
    if (!(e.isPlayer && (e.abilities?.flying && e.creative))) {
      e.vx += dx * kb; e.vy += dy * kb; e.vz += dz * kb;
    }
  }
  // blocks
  for (const [bx, by, bz, v] of toBreak.values()) {
    const def = BlockById[v & ID_MASK];
    if (def.name === 'tnt') {
      w.setBlock(bx, by, bz, 0);
      game.primeTnt(bx, by, bz, null, 10 + Math.floor(Math.random() * 20));
      continue;
    }
    w.setBlock(bx, by, bz, 0);
    if (Math.random() < 1 / power) game.dropBlockItems(bx, by, bz, v, null, null, true);
    else if (def.interact === 'chest' || def.interact === 'furnace') { /* contents spill via onBlockEntityRemoved */ }
  }
  if (fire) {
    for (const [bx, by, bz] of toBreak.values()) {
      if (Math.random() < 1 / 3 && w.getBlock(bx, by, bz) === 0 && BlockById[w.getBlock(bx, by - 1, bz) & ID_MASK].opaque) w.setBlock(bx, by, bz, packBlock(B.fire, 0));
    }
  }
  game.sound.play('random.explode', { x: cx, y: cy, z: cz, volume: 4, pitch: (1 + (Math.random() - Math.random()) * 0.2) * 0.7 });
  game.fx?.explosion?.(cx, cy, cz, power, toBreak.size);
}

function seenPercent(w, cx, cy, cz, e) {
  const b = e.aabb();
  const sx = 1 / ((b[3] - b[0]) * 2 + 1), sy = 1 / ((b[4] - b[1]) * 2 + 1), sz = 1 / ((b[5] - b[2]) * 2 + 1);
  const ox = (1 - Math.floor(1 / sx) * sx) / 2, oz = (1 - Math.floor(1 / sz) * sz) / 2;
  let seen = 0, total = 0;
  for (let fx = 0; fx <= 1; fx += sx) for (let fy = 0; fy <= 1; fy += sy) for (let fz = 0; fz <= 1; fz += sz) {
    const px = b[0] + (b[3] - b[0]) * fx + ox, py = b[1] + (b[4] - b[1]) * fy, pz = b[2] + (b[5] - b[2]) * fz + oz;
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) { seen++; total++; continue; }
    const hit = raycastBlocks(w, cx, cy, cz, dx / d, dy / d, dz / d, d);
    if (!hit || !BlockById[hit.value & ID_MASK].solid) seen++;
    total++;
  }
  return total ? seen / total : 0;
}
