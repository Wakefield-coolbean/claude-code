// Mobs: AI (pathfinding, targeting, attacks), drops, and per-species behaviour.
import { LivingEntity } from './living.js';
import { ID_MASK, packBlock } from '../constants.js';
import { BlockById, B, WOOL_COLORS } from '../registry/blocks.js';
import { Items } from '../registry/items.js';
import { ItemStack } from '../game/inventory.js';
import { raycastBlocks } from '../game/raycast.js';
import { wrapAngle } from '../util/math.js';
import { Arrow } from './objects.js';

const idOf = (v) => v & ID_MASK;
let pathBudget = 0;
export function resetPathBudget() { pathBudget = 6; }

// ---------------- pathfinding ----------------
function passable(w, x, y, z) {
  const def = BlockById[idOf(w.getBlock(x, y, z))];
  if (def.liquid === 'lava' || def.name === 'fire' || def.name === 'cactus' || def.berry || def.name === 'cobweb') return false;
  if (!def.solid) return true;
  if (def.shape === 'door') return true; // doors handled crudely (mobs can't open, but treat as blocking below)
  return false;
}
function solidFloor(w, x, y, z) {
  const def = BlockById[idOf(w.getBlock(x, y, z))];
  return (def.solid && def.shape !== 'fence') || def.liquid === 'water';
}
function isWater(w, x, y, z) { return BlockById[idOf(w.getBlock(x, y, z))].liquid === 'water'; }

function canStand(w, x, y, z, h) {
  for (let i = 0; i < h; i++) if (!passable(w, x, y + i, z)) return false;
  return solidFloor(w, x, y - 1, z) || isWater(w, x, y, z);
}

export function findPath(w, sx, sy, sz, tx, ty, tz, h, maxNodes = 400, maxDist = 32) {
  if (pathBudget <= 0) return null;
  pathBudget--;
  const key = (x, y, z) => `${x},${y},${z}`;
  const open = [];
  const nodes = new Map();
  const start = { x: sx, y: sy, z: sz, g: 0, f: 0, parent: null, closed: false };
  start.f = Math.abs(tx - sx) + Math.abs(ty - sy) + Math.abs(tz - sz);
  nodes.set(key(sx, sy, sz), start);
  open.push(start);
  let best = start, bestH = start.f;
  let count = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (open.length && count < maxNodes) {
    // pop lowest f
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    cur.closed = true;
    count++;
    const hdist = Math.abs(tx - cur.x) + Math.abs(ty - cur.y) + Math.abs(tz - cur.z);
    if (hdist < bestH) { bestH = hdist; best = cur; }
    if (hdist <= 1) { best = cur; break; }
    for (const [dx, dz] of dirs) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (Math.abs(nx - sx) > maxDist || Math.abs(nz - sz) > maxDist) continue;
      if (dx !== 0 && dz !== 0) {
        // no corner cutting
        if (!passable(w, cur.x + dx, cur.y, cur.z) || !passable(w, cur.x, cur.y, cur.z + dz)) continue;
        if (h > 1 && (!passable(w, cur.x + dx, cur.y + 1, cur.z) || !passable(w, cur.x, cur.y + 1, cur.z + dz))) continue;
      }
      let ny = null;
      if (canStand(w, nx, cur.y, nz, h)) ny = cur.y;
      else if (canStand(w, nx, cur.y + 1, nz, h) && passable(w, cur.x, cur.y + h, cur.z) && (dx === 0 || dz === 0)) ny = cur.y + 1;
      else {
        for (let d = 1; d <= 3; d++) {
          if (!passable(w, nx, cur.y - d + h, nz)) break;
          if (canStand(w, nx, cur.y - d, nz, h)) { ny = cur.y - d; break; }
        }
      }
      if (ny === null) continue;
      const k = key(nx, ny, nz);
      let cost = (dx !== 0 && dz !== 0 ? 1.414 : 1) + (ny > cur.y ? 0.5 : 0) + (isWater(w, nx, ny, nz) ? 2 : 0);
      const g = cur.g + cost;
      let n = nodes.get(k);
      if (!n) {
        n = { x: nx, y: ny, z: nz, g, f: 0, parent: cur, closed: false };
        n.f = g + Math.abs(tx - nx) + Math.abs(ty - ny) + Math.abs(tz - nz);
        nodes.set(k, n);
        open.push(n);
      } else if (!n.closed && g < n.g) {
        n.g = g; n.parent = cur; n.f = g + Math.abs(tx - nx) + Math.abs(ty - ny) + Math.abs(tz - nz);
      }
    }
  }
  const path = [];
  for (let n = best; n; n = n.parent) path.push(n);
  path.reverse();
  return path.length > 1 ? path : null;
}

// ---------------- base mob ----------------
export class Mob extends LivingEntity {
  constructor(world, type) {
    super(world, type);
    this.isLiving = true;
    this.pickable = true;
    this.blocksPlacement = true;
    this.hostile = false;
    this.path = null; this.pathIndex = 0; this.pathTarget = null; this.pathSpeed = 1; this.repath = 0;
    this.speedMod = 1;
    this.target = null;
    this.followRange = 16;
    this.attackCooldown = 0;
    this.ambientTimer = -Math.floor(Math.random() * 80);
    this.ambientInterval = 80;
    this.lookTarget = null; this.lookTime = 0;
    this.strollCooldown = Math.floor(Math.random() * 120);
    this.panicTime = 0;
    this.baby = false;
    this.growAge = 0;
    this.noActionTime = 0;
    this.persistent = false;
    this.burnsInDay = false;
    this.undead = false;
    this.arthropod = false;
    this.loveTime = 0;
    this.breedCooldown = 0;
    this.soundPrefix = type;
    this.stepSounds = true;
  }

  get game() { return this.world.game; }

  effectiveSpeed() { return super.effectiveSpeed() * this.speedMod; }

  playSound(kind, vol = 1) {
    const pitch = this.baby ? (Math.random() - Math.random()) * 0.2 + 1.5 : (Math.random() - Math.random()) * 0.2 + 1;
    this.game?.sound?.play(`mob.${this.soundPrefix}.${kind}`, { x: this.x, y: this.y + this.height / 2, z: this.z, volume: vol, pitch });
  }

  canSee(e) {
    const ox = this.x, oy = this.y + this.eyeHeight, oz = this.z;
    const tx = e.x, ty = e.y + (e.eyeHeight ?? 1), tz = e.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 128) return false;
    const hit = raycastBlocks(this.world, ox, oy, oz, dx / d, dy / d, dz / d, d);
    return !hit || !BlockById[hit.value & ID_MASK].opaque;
  }

  // Navigation -------------------------------------------------
  moveTo(x, y, z, speed = 1) {
    const sx = Math.floor(this.x), sy = Math.floor(this.y + 0.01), sz = Math.floor(this.z);
    const h = Math.max(1, Math.ceil(this.height));
    const path = findPath(this.world, sx, sy, sz, Math.floor(x), Math.floor(y), Math.floor(z), Math.min(h, 2), 300, Math.ceil(this.followRange) + 8);
    if (!path) return false;
    this.path = path; this.pathIndex = 1; this.pathSpeed = speed; this.pathTarget = [x, y, z];
    return true;
  }
  stopNav() { this.path = null; this.moveForward = 0; this.moveStrafe = 0; }
  get navigating() { return !!this.path; }

  followPath() {
    if (!this.path) { this.speedMod = 1; return; }
    if (this.pathIndex >= this.path.length) { this.stopNav(); return; }
    const n = this.path[this.pathIndex];
    const tx = n.x + 0.5, tz = n.z + 0.5;
    const dx = tx - this.x, dz = tz - this.z;
    const dh = Math.hypot(dx, dz);
    if (dh < Math.max(0.35, this.width / 2) && Math.abs(n.y - this.y) < 1.2) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) { this.stopNav(); return; }
      return this.followPath();
    }
    const targetYaw = Math.atan2(-dx, -dz);
    this.yaw += clampAngle(wrapAngle(targetYaw - this.yaw), 1.57);
    // vanilla MoveControl: forward input equals the (modified) speed attribute
    this.speedMod = this.pathSpeed;
    this.moveForward = this.speed * this.pathSpeed;
    if ((n.y > this.y + 0.5 && dh < 1.5) || (this.horizontalCollision && this.onGround)) this.jumping = true;
    if (this.inWater && this.waterHeight > 0.3) this.jumping = true;
    // stuck detection
    if (this.age % 40 === 0) {
      if (this.lastPos && Math.hypot(this.x - this.lastPos[0], this.z - this.lastPos[1]) < 0.3) this.stopNav();
      this.lastPos = [this.x, this.z];
    }
  }

  lookAtEntity(e, maxYaw = 0.5) {
    const dx = e.x - this.x, dz = e.z - this.z, dy = (e.y + (e.eyeHeight ?? 1)) - (this.y + this.eyeHeight);
    const targetYaw = Math.atan2(-dx, -dz);
    this.headYawTarget = targetYaw;
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (!this.navigating) this.yaw += clampAngle(wrapAngle(targetYaw - this.yaw), maxYaw);
  }

  randomStroll(speed = 1, chance = 120, range = 10) {
    if (this.navigating) return;
    if (--this.strollCooldown > 0) return;
    this.strollCooldown = Math.floor(Math.random() * chance) + chance / 2;
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(this.x + (Math.random() * 2 - 1) * range);
      const tz = Math.floor(this.z + (Math.random() * 2 - 1) * range);
      const ty = Math.floor(this.y + (Math.random() * 2 - 1) * 3);
      for (let dy = 3; dy >= -3; dy--) {
        if (canStand(this.world, tx, ty + dy, tz, Math.min(2, Math.ceil(this.height)))) {
          if (this.preferGrass && idOf(this.world.getBlock(tx, ty + dy - 1, tz)) !== B.grass_block && Math.random() < 0.7) continue;
          this.moveTo(tx + 0.5, ty + dy, tz + 0.5, speed);
          return;
        }
      }
    }
  }

  nearestPlayer(range, requireSight = false) {
    const p = this.game?.player;
    if (!p || p.dead || p.spectator || p.creative) return null;
    if (this.distanceTo(p) > range) return null;
    if (requireSight && !this.canSee(p)) return null;
    return p;
  }

  isSunBurning() {
    if (!this.burnsInDay || this.world.isNight() || this.world.raining) return false;
    if (this.inWater || this.equipment.head) return false;
    const bx = Math.floor(this.x), by = Math.floor(this.y + this.eyeHeight), bz = Math.floor(this.z);
    const br = this.world.getRawBrightness(bx, by, bz, this.world.skyDarken());
    return br > 11 && Math.random() * 30 < (br / 15 - 0.4) * 2 && this.world.canSeeSky(bx, by, bz);
  }

  aiStep() {
    // ambient sounds
    if (++this.ambientTimer > this.ambientInterval && Math.random() * 1000 < this.ambientTimer - this.ambientInterval + 0) {
      this.ambientTimer = -this.ambientInterval;
      if (!this.dead) this.playAmbient();
    }
    if (this.isSunBurning()) this.setOnFire(8);
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.growAge < 0) { this.growAge++; if (this.growAge === 0) this.setBaby(false); }
    if (this.loveTime > 0) { this.loveTime--; if (this.loveTime % 10 === 0) this.game?.fx?.hearts?.(this); }
    if (this.breedCooldown > 0) this.breedCooldown--;
    super.aiStep();
  }

  playAmbient() { this.playSound('say', 1); }

  serverAiStep() {
    this.jumping = false;
    this.moveForward = 0; this.moveStrafe = 0;
    this.think();
    this.followPath();
    // swim
    if (this.inWater && this.waterHeight > this.height * 0.4 + 0.1) this.jumping = true;
    if (this.inLava) this.jumping = true;
  }

  think() {}

  onHurtEffects(source) {
    this.playSound('hurt');
    if (source.entity && this.onHurtBy) this.onHurtBy(source.entity);
  }

  // ---------- death & loot ----------
  onDeath(source) {
    this.playSound('death');
    this.stopNav();
    const g = this.game;
    if (!g) return;
    const killer = (source.entity?.isPlayer ? source.entity : null) ?? (this.lastHurtBy?.isPlayer ? this.lastHurtBy : null);
    const looting = killer?.inventory?.held?.enchantLevel?.('looting') ?? 0;
    if (!this.baby) {
      for (const d of this.loot(killer, looting)) if (d.count > 0) g.spawnItem(this.x, this.y + 0.5, this.z, new ItemStack(Items[d.item].id, d.count), { scatter: true });
      if (killer && this.xpReward > 0) g.spawnXp(this.x, this.y + 0.5, this.z, typeof this.xpReward === 'function' ? this.xpReward() : this.xpReward);
    }
  }
  loot() { return []; }

  onDeathAnimationDone() {
    this.remove();
    this.game?.fx?.poof?.(this);
  }

  setBaby(b) {
    this.baby = b;
    if (b) { this.growAge = -24000; this.width = this.adultWidth * 0.5; this.height = this.adultHeight * 0.5; this.eyeHeight = this.adultEye * 0.5; }
    else { this.width = this.adultWidth; this.height = this.adultHeight; this.eyeHeight = this.adultEye; }
  }

  size(w, h, eye) {
    this.width = this.adultWidth = w; this.height = this.adultHeight = h; this.eyeHeight = this.adultEye = eye ?? h * 0.85;
  }

  interact(player, stack) { void player; void stack; return false; }

  serialize() { return { ...super.serialize(), health: this.health, baby: this.baby, growAge: this.growAge, persistent: this.persistent, extra: this.extraData?.() }; }
  deserialize(d) {
    super.deserialize(d);
    this.health = d.health ?? this.maxHealth;
    if (d.baby) { this.setBaby(true); this.growAge = d.growAge ?? -24000; }
    this.persistent = !!d.persistent;
    if (d.extra) this.loadExtra?.(d.extra);
  }
}

function clampAngle(a, m) { return a > m ? m : a < -m ? -m : a; }
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ---------------- hostile base ----------------
class Monster extends Mob {
  constructor(world, type) {
    super(world, type);
    this.hostile = true;
    this.xpReward = 5;
    this.followRange = 35;
    this.attackDamage = 3;
  }
  get difficultyDamage() {
    const d = this.world.difficulty;
    if (d === 1) return Math.min(this.attackDamage / 2 + 1, this.attackDamage);
    if (d === 3) return this.attackDamage * 3 / 2;
    return this.attackDamage;
  }
  acquireTarget(requireSight = true) {
    if (this.target && (this.target.dead || this.target.creative || this.target.spectator || this.distanceTo(this.target) > this.followRange)) this.target = null;
    if (!this.target && this.age % 10 === 0) {
      const p = this.nearestPlayer(this.followRange * 0.5, requireSight);
      if (p) this.target = p;
    }
    return this.target;
  }
  onHurtBy(e) { if (e.isPlayer && !e.creative) this.target = e; }

  meleeAttack(speed = 1) {
    const t = this.target;
    if (!t) return;
    this.lookAtEntity(t, 0.6);
    const d2 = (this.x - t.x) ** 2 + (this.y - t.y) ** 2 + (this.z - t.z) ** 2;
    if (--this.repath <= 0 || !this.navigating) {
      this.repath = 4 + Math.floor(Math.random() * 7) + (d2 > 1024 ? 10 : d2 > 256 ? 5 : 0);
      if (!this.moveTo(t.x, t.y, t.z, speed)) this.repath += 15;
    }
    const reach = this.width * 2 * this.width * 2 + t.width;
    if (d2 <= reach + 0.5 && this.attackCooldown <= 0 && this.canSee(t)) {
      this.attackCooldown = 20;
      this.swing();
      this.doHurtTarget(t);
    }
  }
  doHurtTarget(t) {
    const ok = t.hurt({ type: 'mob', entity: this, pos: [this.x, this.y, this.z] }, this.difficultyDamage);
    if (ok && this.fireTicks > 0 && Math.random() < 0.3 * this.world.difficulty) t.setOnFire?.(2 * this.world.difficulty);
    return ok;
  }
  fleeSun() {
    if (this.fireTicks <= 0 || this.navigating) return false;
    if (!this.world.canSeeSky(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z))) return false;
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(this.x + Math.random() * 20 - 10), tz = Math.floor(this.z + Math.random() * 20 - 10);
      const ty = Math.floor(this.y + Math.random() * 6 - 3);
      if (canStand(this.world, tx, ty, tz, 2) && !this.world.canSeeSky(tx, ty + 1, tz)) { this.moveTo(tx + 0.5, ty, tz + 0.5, 1.2); return true; }
    }
    return false;
  }
}

export class Zombie extends Monster {
  constructor(world) {
    super(world, 'zombie');
    this.size(0.6, 1.95, 1.74);
    this.maxHealth = this.health = 20;
    this.speed = 0.23;
    this.attackDamage = 3;
    this.burnsInDay = true;
    this.undead = true;
    this.aggressive = false;
    if (Math.random() < 0.05) this.setBaby(true);
    if (this.baby) this.speed = 0.23 * 1.5;
  }
  armorValue() { return super.armorValue() + 2; }
  think() {
    this.acquireTarget();
    this.aggressive = !!this.target;
    if (this.target) this.meleeAttack(1);
    else {
      if (!this.fleeSun()) this.randomStroll(1);
      const p = this.nearestPlayer(8);
      if (p && Math.random() < 0.02) this.lookAtEntity(p);
    }
  }
  loot(killer, looting) {
    const out = [{ item: 'rotten_flesh', count: rnd(0, 2 + looting) }];
    if (killer && Math.random() < 0.025 + looting * 0.01) out.push({ item: ['iron_ingot', 'carrot', 'potato'][rnd(0, 2)], count: 1 });
    return out;
  }
  xpRewardFn() { return 5; }
}

export class Skeleton extends Monster {
  constructor(world) {
    super(world, 'skeleton');
    this.size(0.6, 1.99, 1.74);
    this.maxHealth = this.health = 20;
    this.speed = 0.25;
    this.burnsInDay = true;
    this.undead = true;
    this.drawTime = -1;
    this.seeTime = 0;
    this.strafeTime = -1; this.strafeLeft = false; this.strafeBack = false;
    this.equipment.mainhand = ItemStack.of('bow');
  }
  think() {
    const t = this.acquireTarget();
    if (!t) {
      this.drawTime = -1;
      if (!this.fleeSun()) this.randomStroll(1);
      return;
    }
    const d = this.distanceTo(t);
    const sees = this.canSee(t);
    this.seeTime = sees ? this.seeTime + 1 : Math.min(0, this.seeTime - 1);
    if (d <= 15 && this.seeTime >= 20) { this.stopNav(); this.strafeTime++; }
    else if (--this.repath <= 0 || !this.navigating) { this.repath = 20; this.moveTo(t.x, t.y, t.z, 1); this.strafeTime = -1; }
    if (this.strafeTime >= 20) {
      if (Math.random() < 0.3) this.strafeLeft = !this.strafeLeft;
      if (Math.random() < 0.3) this.strafeBack = !this.strafeBack;
      this.strafeTime = 0;
    }
    this.lookAtEntity(t, 0.8);
    if (this.strafeTime > -1) {
      if (d > 11.25) this.strafeBack = false; else if (d < 3.75) this.strafeBack = true;
      this.speedMod = 1;
      this.moveForward = this.strafeBack ? -0.5 : 0.5;
      this.moveStrafe = this.strafeLeft ? 0.5 : -0.5;
      this.yaw = this.headYawTarget ?? this.yaw;
    }
    const interval = this.world.difficulty === 3 ? 20 : 40;
    if (this.drawTime >= 0) {
      if (!sees && this.seeTime < -60) this.drawTime = -1;
      else if (sees) {
        this.drawTime++;
        if (this.drawTime >= 20) {
          this.shoot(t, 1);
          this.drawTime = -1;
          this.attackCooldown = interval;
        }
      }
    } else if (this.attackCooldown <= 0 && this.seeTime >= -60 && d < 16) this.drawTime = 0;
  }
  shoot(t, power) {
    const a = new Arrow(this.world, this);
    a.setPos(this.x, this.y + this.eyeHeight - 0.1, this.z);
    const dx = t.x - this.x, dz = t.z - this.z;
    const dy = t.y + t.height / 3 - a.y;
    const h = Math.hypot(dx, dz);
    a.baseDamage = 2 + this.world.difficulty * 0.11 + (Math.random() - 0.5) * 0.25;
    a.shoot(dx, dy + h * 0.2, dz, 1.6 * power, 14 - this.world.difficulty * 4);
    this.game?.spawnEntity(a);
    this.game?.sound?.play('random.bow', { x: this.x, y: this.y, z: this.z, pitch: 1 / (Math.random() * 0.4 + 0.8) });
  }
  get isDrawing() { return this.drawTime >= 0; }
  loot(killer, looting) { return [{ item: 'bone', count: rnd(0, 2 + looting) }, { item: 'arrow', count: rnd(0, 2 + looting) }]; }
}

export class Creeper extends Monster {
  constructor(world) {
    super(world, 'creeper');
    this.size(0.6, 1.7, 1.445);
    this.maxHealth = this.health = 20;
    this.speed = 0.25;
    this.swell = 0; this.oswell = 0; this.swellDir = -1;
    this.maxSwell = 30;
    this.powered = false;
    this.ambientInterval = 1e9;
  }
  playAmbient() {}
  tick() {
    this.oswell = this.swell;
    super.tick();
  }
  think() {
    const t = this.acquireTarget();
    if (t) {
      const d = this.distanceTo(t);
      if (this.swellDir > 0 && d > 7) this.swellDir = -1;
      else if (d < 3 && this.canSee(t)) this.swellDir = 1;
      else if (this.swellDir > 0 && !this.canSee(t)) this.swellDir = -1;
      if (this.swellDir > 0) { this.stopNav(); this.lookAtEntity(t, 1); }
      else this.meleeApproach(t);
    } else { this.swellDir = -1; this.randomStroll(1); }
    if (this.ignited) this.swellDir = 1;
    if (this.swellDir > 0 && this.swell === 0) this.game?.sound?.play('mob.creeper.primed', { x: this.x, y: this.y, z: this.z, pitch: 0.5 });
    this.swell = Math.max(0, this.swell + this.swellDir);
    if (this.swell >= this.maxSwell) {
      this.swell = this.maxSwell;
      this.explodeCreeper();
    }
  }
  meleeApproach(t) {
    this.lookAtEntity(t, 0.6);
    if (--this.repath <= 0 || !this.navigating) { this.repath = 5 + Math.floor(Math.random() * 7); this.moveTo(t.x, t.y, t.z, 1); }
  }
  explodeCreeper() {
    if (this.dead || this.removed) return;
    this.dead = true;
    this.remove();
    const power = this.powered ? 6 : 3;
    this.game?.explode(this.x, this.y, this.z, power, { source: this, breakBlocks: this.world.gamerules.mobGriefing });
  }
  interact(player, stack) {
    if (stack?.item?.use === 'ignite') {
      this.game?.sound?.play('fire.ignite', { x: this.x, y: this.y, z: this.z });
      this.ignited = true;
      this.game?.interaction?.damageHeld('main', 1);
      return true;
    }
    return false;
  }
  swelling(t) { return ((this.oswell + (this.swell - this.oswell) * t) / (this.maxSwell - 2)); }
  loot(killer, looting) { return [{ item: 'gunpowder', count: rnd(0, 2 + looting) }]; }
}

export class Spider extends Monster {
  constructor(world) {
    super(world, 'spider');
    this.size(1.4, 0.9, 0.65);
    this.maxHealth = this.health = 16;
    this.speed = 0.3;
    this.attackDamage = 2;
    this.arthropod = true;
  }
  onClimbable() { return this.horizontalCollision || super.onClimbable(); }
  think() {
    const bright = this.world.getRawBrightness(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z), this.world.skyDarken()) / 15;
    if (this.target && bright > 0.5 && Math.random() < 0.01 && !this.provoked) this.target = null;
    if (!this.target && bright < 0.5) this.acquireTarget(true);
    else if (this.target) this.acquireTarget(false);
    const t = this.target;
    if (t) {
      const d = this.distanceTo(t);
      if (this.onGround && d > 2 && d < 4 && Math.random() < 0.2) {
        const dx = t.x - this.x, dz = t.z - this.z, h = Math.hypot(dx, dz);
        this.vx += dx / h * 0.4 * 0.8 + this.vx * 0.2; this.vz += dz / h * 0.4 * 0.8 + this.vz * 0.2; this.vy = 0.4;
      }
      this.meleeAttack(1);
    } else this.randomStroll(0.8);
  }
  onHurtBy(e) { super.onHurtBy(e); this.provoked = true; }
  loot(killer, looting) {
    const out = [{ item: 'string', count: rnd(0, 2 + looting) }];
    if (killer && Math.random() < 1 / 3 + looting / 3) out.push({ item: 'spider_eye', count: 1 });
    return out;
  }
}

export class Enderman extends Monster {
  constructor(world) {
    super(world, 'enderman');
    this.size(0.6, 2.9, 2.55);
    this.maxHealth = this.health = 40;
    this.speed = 0.3;
    this.attackDamage = 7;
    this.followRange = 64;
    this.angry = false;
    this.stareTime = 0;
    this.soundPrefix = 'enderman';
  }
  playAmbient() { this.playSound(this.angry ? 'scream' : 'idle', 1); }
  think() {
    const p = this.game?.player;
    if (!this.angry && p && !p.creative && !p.spectator && !p.dead && this.distanceTo(p) < 64 && this.isLookedAt(p)) {
      if (++this.stareTime > 5) { this.angry = true; this.target = p; this.game?.sound?.play('mob.enderman.stare', { x: this.x, y: this.y, z: this.z }); this.playSound('scream'); }
    } else this.stareTime = 0;
    if (this.target && (this.target.dead || this.target.creative)) { this.target = null; this.angry = false; }
    if (this.angry && this.target) {
      const d = this.distanceTo(this.target);
      if (d > 16 && Math.random() < 0.05) this.teleportTowards(this.target);
      this.meleeAttack(1.2);
    } else this.randomStroll(1);
    if ((this.inWater || (this.world.raining && this.world.canSeeSky(Math.floor(this.x), Math.floor(this.y + 2), Math.floor(this.z)))) && this.age % 10 === 0) {
      this.hurt({ type: 'drown' }, 1);
      this.teleportRandom();
    }
  }
  isLookedAt(p) {
    const cp = Math.cos(p.pitch);
    const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
    const dx = this.x - p.x, dy = this.y + this.eyeHeight - (p.y + p.eyeHeight), dz = this.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    const dot = (lx * dx + ly * dy + lz * dz) / d;
    if (p.equipment?.head?.item?.name === 'carved_pumpkin') return false;
    return dot > 1 - 0.025 / d && this.canSee(p);
  }
  teleportRandom() {
    for (let i = 0; i < 16; i++) {
      const tx = this.x + (Math.random() - 0.5) * 64, tz = this.z + (Math.random() - 0.5) * 64, ty = this.y + Math.floor(Math.random() * 64) - 32;
      if (this.teleport(tx, ty, tz)) return true;
    }
    return false;
  }
  teleportTowards(e) {
    const dx = this.x - e.x, dz = this.z - e.z, dy = this.y - e.y;
    const d = Math.hypot(dx, dy, dz);
    return this.teleport(this.x + (Math.random() - 0.5) * 8 - dx / d * 16, this.y + Math.random() * 16 - 8 - dy / d * 16, this.z + (Math.random() - 0.5) * 8 - dz / d * 16);
  }
  teleport(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y);
    while (by > -64 && !solidFloor(this.world, bx, by - 1, bz)) by--;
    if (!canStand(this.world, bx, by, bz, 3) || isWater(this.world, bx, by, bz)) return false;
    this.game?.fx?.portal?.(this.x, this.y, this.z);
    this.setPos(bx + 0.5, by, bz + 0.5);
    this.stopNav();
    this.game?.sound?.play('mob.enderman.portal', { x: this.x, y: this.y, z: this.z });
    return true;
  }
  hurt(source, amount) {
    if (source.type === 'arrow') { for (let i = 0; i < 64; i++) if (this.teleportRandom()) return false; return false; }
    const r = super.hurt(source, amount);
    if (r && source.entity?.isPlayer) { this.angry = true; this.target = source.entity; }
    if (r && Math.random() < 0.5 && !this.dead) this.teleportRandom();
    return r;
  }
  loot(killer, looting) { return [{ item: 'ender_pearl', count: rnd(0, 1 + looting) }]; }
}

// ---------------- animals ----------------
class Animal extends Mob {
  constructor(world, type) {
    super(world, type);
    this.xpReward = () => 1 + Math.floor(Math.random() * 3);
    this.persistent = true;
    this.temptItems = [];
    this.breedItems = [];
    this.preferGrass = true;
    this.ambientInterval = 120;
  }
  think() {
    const p = this.game?.player;
    if (this.panicTime > 0) {
      this.panicTime--;
      if (!this.navigating) {
        const tx = this.x + (Math.random() * 2 - 1) * 5, tz = this.z + (Math.random() * 2 - 1) * 5;
        this.moveTo(tx, this.y, tz, 1.5);
      }
      return;
    }
    // breeding
    if (this.loveTime > 0) {
      const mate = this.findMate();
      if (mate) {
        this.lookAtEntity(mate);
        if (this.distanceTo(mate) > 2) { if (!this.navigating || this.age % 20 === 0) this.moveTo(mate.x, mate.y, mate.z, 1); }
        else if (this.id < mate.id) {
          this.loveTime = 0; mate.loveTime = 0;
          this.breedCooldown = mate.breedCooldown = 6000;
          const baby = this.game.spawnMob(this.type, this.x, this.y, this.z, { baby: true });
          if (baby && this.type === 'sheep') baby.color = Math.random() < 0.5 ? this.color : mate.color;
          this.game.spawnXp(this.x, this.y, this.z, 1 + Math.floor(Math.random() * 7));
        }
        return;
      }
    }
    // follow parent
    if (this.baby && this.age % 20 === 0) {
      const parent = this.game.entities.list.find((e) => e.type === this.type && !e.baby && e.distanceTo(this) < 8 && e.distanceTo(this) > 3);
      if (parent) this.moveTo(parent.x, parent.y, parent.z, 1.1);
    }
    // tempt
    if (p && !p.dead && !p.spectator && this.distanceTo(p) < 10) {
      const held = p.inventory.held?.item?.name, off = p.inventory.offhand?.item?.name;
      if (this.temptItems.includes(held) || this.temptItems.includes(off)) {
        this.lookAtEntity(p, 1);
        if (this.distanceTo(p) > 2.5) { if (!this.navigating || this.age % 10 === 0) this.moveTo(p.x, p.y, p.z, 1.1); }
        else this.stopNav();
        return;
      }
      if (Math.random() < 0.02) { this.lookTarget = p; this.lookTime = 40 + Math.floor(Math.random() * 40); }
    }
    if (this.lookTime > 0 && this.lookTarget) { this.lookTime--; this.lookAtEntity(this.lookTarget, 0.3); }
    this.idle();
    this.randomStroll(1, 120, 10);
  }
  idle() {}
  findMate() {
    let best = null, bd = 8;
    for (const e of this.game.entities.list) {
      if (e === this || e.type !== this.type || e.loveTime <= 0 || e.baby || e.dead) continue;
      const d = this.distanceTo(e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  onHurtBy() { this.panicTime = 60 + Math.floor(Math.random() * 40); this.stopNav(); }
  interact(player, stack) {
    const name = stack?.item?.name;
    if (name && this.breedItems.includes(name)) {
      if (this.baby) { this.growAge = Math.min(0, this.growAge + Math.floor(-this.growAge / 10)); this.consume(player); return true; }
      if (this.breedCooldown === 0 && this.loveTime === 0) {
        this.loveTime = 600;
        this.consume(player);
        this.game?.fx?.hearts?.(this);
        return true;
      }
    }
    return false;
  }
  consume(player) {
    if (player.creative) return;
    const s = player.inventory.held;
    if (s) { s.count--; if (s.count <= 0) player.inventory.held = null; player.inventory.changed(); }
  }
}

export class Pig extends Animal {
  constructor(world) {
    super(world, 'pig');
    this.size(0.9, 0.9, 0.765);
    this.maxHealth = this.health = 10;
    this.speed = 0.25;
    this.temptItems = ['carrot', 'potato', 'golden_carrot'];
    this.breedItems = ['carrot', 'potato'];
  }
  loot(killer, looting) { return [{ item: this.fireTicks > 0 ? 'cooked_porkchop' : 'porkchop', count: rnd(1, 3 + looting) }]; }
}

export class Cow extends Animal {
  constructor(world) {
    super(world, 'cow');
    this.size(0.9, 1.4, 1.3);
    this.maxHealth = this.health = 10;
    this.speed = 0.2;
    this.temptItems = ['wheat'];
    this.breedItems = ['wheat'];
  }
  interact(player, stack) {
    if (stack?.item?.name === 'bucket' && !this.baby) {
      this.game?.sound?.play('mob.cow.milk', { x: this.x, y: this.y, z: this.z });
      this.game.interaction.replaceHeld('main', ItemStack.of('milk_bucket'));
      return true;
    }
    return super.interact(player, stack);
  }
  loot(killer, looting) { return [{ item: 'leather', count: rnd(0, 2 + looting) }, { item: this.fireTicks > 0 ? 'cooked_beef' : 'beef', count: rnd(1, 3 + looting) }]; }
}

export class Sheep extends Animal {
  constructor(world) {
    super(world, 'sheep');
    this.size(0.9, 1.3, 1.235);
    this.maxHealth = this.health = 8;
    this.speed = 0.23;
    this.temptItems = ['wheat'];
    this.breedItems = ['wheat'];
    this.sheared = false;
    this.eatTime = 0;
    const r = Math.random() * 100;
    this.color = r < 5 ? 'black' : r < 10 ? 'gray' : r < 15 ? 'light_gray' : r < 18 ? 'brown' : r < 18.164 ? 'pink' : 'white';
  }
  idle() {
    if (this.eatTime > 0) {
      this.eatTime--;
      this.stopNav();
      if (this.eatTime === 4) {
        const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
        const w = this.world;
        if (idOf(w.getBlock(x, y, z)) === B.grass) { w.setBlock(x, y, z, 0); this.ateGrass(); }
        else if (idOf(w.getBlock(x, y - 1, z)) === B.grass_block) {
          w.setBlock(x, y - 1, z, B.dirt);
          this.game?.fx?.blockBreak?.(x, y - 1, z, B.grass_block);
          this.ateGrass();
        }
      }
      return;
    }
    if (Math.random() < (this.baby ? 1 / 50 : 1 / 1000) && !this.navigating) {
      const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
      if (idOf(this.world.getBlock(x, y - 1, z)) === B.grass_block || idOf(this.world.getBlock(x, y, z)) === B.grass) this.eatTime = 40;
    }
  }
  ateGrass() {
    this.sheared = false;
    if (this.baby) this.growAge = Math.min(0, this.growAge + 1200);
  }
  interact(player, stack) {
    if (stack?.item?.name === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      this.game?.sound?.play('mob.sheep.shear', { x: this.x, y: this.y, z: this.z });
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.game.spawnItem(this.x, this.y + 1, this.z, ItemStack.of(`${this.color}_wool`), { velocity: [(Math.random() - Math.random()) * 0.1, Math.random() * 0.05, (Math.random() - Math.random()) * 0.1] });
      this.game.interaction.damageHeld('main', 1);
      return true;
    }
    const dye = stack?.item?.name;
    if (dye && dye.endsWith('_dye') && !this.sheared) {
      const c = dye.replace('_dye', '');
      if (WOOL_COLORS.includes(c) && c !== this.color) { this.color = c; if (!player.creative) this.consume(player); return true; }
    }
    return super.interact(player, stack);
  }
  loot(killer, looting) {
    const out = [{ item: this.fireTicks > 0 ? 'cooked_mutton' : 'mutton', count: rnd(1, 2 + looting) }];
    if (!this.sheared) out.push({ item: `${this.color}_wool`, count: 1 });
    return out;
  }
  extraData() { return { color: this.color, sheared: this.sheared }; }
  loadExtra(d) { this.color = d.color ?? 'white'; this.sheared = !!d.sheared; }
}

export class Chicken extends Animal {
  constructor(world) {
    super(world, 'chicken');
    this.size(0.4, 0.7, 0.644);
    this.maxHealth = this.health = 4;
    this.speed = 0.25;
    this.temptItems = ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'];
    this.breedItems = ['wheat_seeds'];
    this.eggTime = 6000 + Math.floor(Math.random() * 6000);
    this.flap = 0; this.oflap = 0; this.flapSpeed = 0; this.oFlapSpeed = 0; this.flapping = 1;
  }
  aiStep() {
    super.aiStep();
    this.oflap = this.flap; this.oFlapSpeed = this.flapSpeed;
    this.flapSpeed += (this.onGround ? -1 : 4) * 0.3;
    this.flapSpeed = Math.max(0, Math.min(1, this.flapSpeed));
    if (!this.onGround && this.flapping < 1) this.flapping = 1;
    this.flapping *= 0.9;
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
    this.flap += this.flapping * 2;
    if (!this.baby && --this.eggTime <= 0) {
      this.game?.sound?.play('mob.chicken.plop', { x: this.x, y: this.y, z: this.z, pitch: (Math.random() - Math.random()) * 0.2 + 1 });
      this.game?.spawnItem(this.x, this.y, this.z, ItemStack.of('egg'));
      this.eggTime = 6000 + Math.floor(Math.random() * 6000);
    }
  }
  onLand() {}
  loot(killer, looting) { return [{ item: 'feather', count: rnd(0, 2 + looting) }, { item: this.fireTicks > 0 ? 'cooked_chicken' : 'chicken', count: 1 }]; }
}

// Villagers wander their village by day and head home at night; they panic when hurt.
class Villager extends Animal {
  constructor(world) {
    super(world, 'villager');
    this.size(0.6, 1.95, 1.62);
    this.maxHealth = this.health = 20;
    this.speed = 0.5;
    this.preferGrass = false;
    this.ambientInterval = 1e9;
    this.home = null;
  }
  playSound(kind) {
    if (kind === 'hurt' || kind === 'death') this.game?.sound?.play('damage.hit', { x: this.x, y: this.y + 1, z: this.z, volume: 0.6 });
  }
  think() {
    if (!this.home) this.home = { x: this.x, y: this.y, z: this.z };
    if (this.panicTime > 0) { super.think(); return; }
    const w = this.world, h = this.home;
    const night = w.dayTime % 24000 > 12500 && w.dayTime % 24000 < 23400;
    const far = Math.hypot(this.x - h.x, this.z - h.z);
    if (night || far > 24) {
      if (far > 1.5 && (!this.navigating || this.age % 40 === 0)) this.moveTo(h.x, h.y, h.z, 0.7);
      return;
    }
    const p = this.game?.player;
    if (p && !p.dead && !p.spectator && this.distanceTo(p) < 6 && Math.random() < 0.02) { this.lookTarget = p; this.lookTime = 60; }
    if (this.lookTime > 0 && this.lookTarget) { this.lookTime--; this.lookAtEntity(this.lookTarget, 0.3); return; }
    this.randomStroll(0.6, 80, 8);
  }
  extraData() { return { home: this.home }; }
  loadExtra(d) { this.home = d.home ?? null; }
}

export const MOB_TYPES = { villager: Villager, zombie: Zombie, skeleton: Skeleton, creeper: Creeper, spider: Spider, enderman: Enderman, pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken };
export { packBlock };
