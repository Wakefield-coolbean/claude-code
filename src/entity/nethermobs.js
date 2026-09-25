// Nether mobs and fireballs.
import { Mob, MOB_TYPES } from './mobs.js';
import { Projectile } from './objects.js';
import { ID_MASK, packBlock } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';
import { ItemStack } from '../game/inventory.js';
import { wrapAngle } from '../util/math.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ---------------- fireballs ----------------
export class Fireball extends Projectile {
  constructor(world, owner, small = false) {
    super(world, small ? 'small_fireball' : 'fireball', owner);
    this.small = small;
    this.width = small ? 0.3125 : 1; this.height = this.width;
    this.eyeHeight = this.height / 2;
    this.noGravity = true;
    this.gravityP = 0;
    this.dragP = 0.95;
    this.power = [0, 0, 0];
    this.pickable = !small;       // large fireballs can be punched back
    this.isFireball = true;
    this.life = 0;
    this.explosionPower = 1;
  }
  aim(dx, dy, dz, spread = 0) {
    dx += (Math.random() - 0.5) * spread; dy += (Math.random() - 0.5) * spread * 0.2; dz += (Math.random() - 0.5) * spread;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.power = [dx / l * 0.1, dy / l * 0.1, dz / l * 0.1];
  }
  tick() {
    // accelerate along the power vector (vanilla AbstractHurtingProjectile)
    this.vx += this.power[0]; this.vy += this.power[1]; this.vz += this.power[2];
    super.tick();
    if (++this.life > 400) this.remove();
    if (!this.removed && this.age % 2 === 0) this.world.game?.fx?.smokeAt?.(this.x, this.y + this.height / 2, this.z);
  }
  hurt(source) {
    // punching a large fireball deflects it
    if (this.small || !source.entity) return false;
    const e = source.entity;
    const cp = Math.cos(e.pitch ?? 0);
    const dx = -Math.sin(e.yaw) * cp, dy = Math.sin(e.pitch ?? 0), dz = -Math.cos(e.yaw) * cp;
    this.vx = dx; this.vy = dy; this.vz = dz;
    this.power = [dx * 0.1, dy * 0.1, dz * 0.1];
    this.owner = e; this.leftOwner = true;
    return true;
  }
  onHitEntity(e) {
    const g = this.world.game;
    if (this.small) {
      if (!e.hasEffect?.('fire_resistance') && e.type !== 'blaze') {
        if (e.hurt({ type: 'fire', entity: this.owner, pos: [this.x, this.y, this.z] }, 5)) e.setOnFire?.(5);
      }
      this.remove();
      return;
    }
    e.hurt({ type: 'explosion', entity: this.owner, pos: [this.x, this.y, this.z] }, 6);
    this.explodeHere(g);
  }
  onHitBlock(hit) {
    const g = this.world.game, w = this.world;
    if (this.small) {
      const d = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][hit.face];
      const x = hit.x + d[0], y = hit.y + d[1], z = hit.z + d[2];
      if (w.getBlock(x, y, z) === 0 && w.gamerules.mobGriefing) { w.setBlock(x, y, z, packBlock(B.fire, 0)); w.scheduleTick(x, y, z, 30); }
      this.remove();
      return;
    }
    this.x = hit.hitX; this.y = hit.hitY; this.z = hit.hitZ;
    this.explodeHere(g);
  }
  explodeHere(g) {
    this.remove();
    g?.explode(this.x, this.y, this.z, this.explosionPower, { source: this, fire: true, breakBlocks: this.world.gamerules.mobGriefing });
  }
  serialize() { return null; }
}

// ---------------- zombified piglin ----------------
export class ZombifiedPiglin extends Mob {
  constructor(world) {
    super(world, 'zombified_piglin');
    this.size(0.6, 1.95, 1.79);
    this.maxHealth = this.health = 20;
    this.speed = 0.23;
    this.attackDamage = 5;
    this.xpReward = 5;
    this.followRange = 35;
    this.undead = true;
    this.angerTime = 0;
    this.soundPrefix = 'zombiepig';
    this.equipment.mainhand = ItemStack.of('golden_sword');
    this.persistent = false;
    this.hostile = false; // neutral, but despawns like a monster
    this.nether = true;
    if (Math.random() < 0.05) this.setBaby(true);
  }
  get despawnable() { return true; }
  playAmbient() { this.playSound(this.angerTime > 0 ? 'zpigangry' : 'zpig'); }
  playSound(kind, vol = 1) {
    const map = { hurt: 'zpighurt', death: 'zpigdeath', say: 'zpig' };
    super.playSound(map[kind] ?? kind, vol);
  }
  think() {
    if (this.angerTime > 0) this.angerTime--;
    const t = this.target;
    if (t && (t.dead || t.creative || t.spectator || this.angerTime <= 0)) { this.target = null; this.aggressive = false; }
    if (this.target) {
      this.aggressive = true;
      const d2 = this.distanceSq(t.x, t.y, t.z);
      this.lookAtEntity(t, 0.6);
      if (--this.repath <= 0 || !this.navigating) { this.repath = 5 + Math.floor(Math.random() * 7); this.moveTo(t.x, t.y, t.z, 1); }
      const reach = this.width * 2 * this.width * 2 + t.width;
      if (d2 <= reach + 0.5 && this.attackCooldown <= 0) {
        this.attackCooldown = 20; this.swing();
        const d = this.world.difficulty;
        const dmg = d === 1 ? 5 : d === 3 ? 12 : 8; // golden sword included
        t.hurt({ type: 'mob', entity: this, pos: [this.x, this.y, this.z] }, dmg);
      }
    } else {
      this.aggressive = false;
      this.randomStroll(1);
    }
  }
  onHurtBy(e) {
    if (!e.isPlayer || e.creative) return;
    this.anger(e);
    // alert nearby piglins
    for (const o of this.world.game.entities.list) {
      if (o !== this && o.type === 'zombified_piglin' && !o.dead && o.distanceTo(this) < 20) o.anger(e);
    }
  }
  anger(e) {
    if (this.angerTime <= 0) this.game?.sound?.play('mob.zombiepig.zpigangry', { x: this.x, y: this.y, z: this.z, pitch: 1.5 + Math.random() * 0.4 });
    this.target = e; this.angerTime = 400 + Math.floor(Math.random() * 400);
  }
  loot(killer, looting) {
    const out = [{ item: 'rotten_flesh', count: rnd(0, 1 + looting) }, { item: 'gold_nugget', count: rnd(0, 1 + looting) }];
    if (killer && Math.random() < 0.025 + looting * 0.01) out.push({ item: 'gold_ingot', count: 1 });
    return out;
  }
}

// ---------------- ghast ----------------
export class Ghast extends Mob {
  constructor(world) {
    super(world, 'ghast');
    this.size(4, 4, 2.6);
    this.maxHealth = this.health = 10;
    this.hostile = true;
    this.xpReward = 5;
    this.noGravity = true;
    this.followRange = 100;
    this.chargeTime = 0;
    this.shooting = false;
    this.wander = null;
    this.soundPrefix = 'ghast';
    this.ambientInterval = 80;
    this.nether = true;
  }
  playAmbient() { this.playSound('moan', 5); }
  playSound(kind, vol = 1) {
    const map = { hurt: 'scream', death: 'death', say: 'moan' };
    this.game?.sound?.play(`mob.ghast.${map[kind] ?? kind}`, { x: this.x, y: this.y + 2, z: this.z, volume: Math.max(vol, 3), pitch: (Math.random() - Math.random()) * 0.2 + 1 });
  }
  onClimbable() { return false; }
  travel() {
    // flying mob: simple drag physics
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91;
  }
  onLand() {}
  think() {
    const p = this.game?.player;
    // wander to random nearby points in open air
    if (!this.wander || Math.hypot(this.wander[0] - this.x, this.wander[1] - this.y, this.wander[2] - this.z) < 2 || Math.random() < 0.01) {
      this.wander = [this.x + (Math.random() * 2 - 1) * 16, this.y + (Math.random() * 2 - 1) * 16, this.z + (Math.random() * 2 - 1) * 16];
    }
    const [wx, wy, wz] = this.wander;
    const dx = wx - this.x, dy = wy - this.y, dz = wz - this.z, d = Math.hypot(dx, dy, dz);
    if (d > 0.1 && this.canMoveTo(dx / d, dy / d, dz / d, Math.ceil(d))) {
      this.vx += dx / d * 0.1 * 0.2; this.vy += dy / d * 0.1 * 0.2; this.vz += dz / d * 0.1 * 0.2;
    } else this.wander = null;
    // shoot at the player
    const target = p && !p.dead && !p.creative && !p.spectator && this.distanceTo(p) < 64 && this.canSee(p) ? p : null;
    if (target) {
      this.yaw = Math.atan2(-(target.x - this.x), -(target.z - this.z));
      this.chargeTime++;
      if (this.chargeTime === 10) this.game?.sound?.play('mob.ghast.charge', { x: this.x, y: this.y, z: this.z, volume: 3 });
      if (this.chargeTime === 20) {
        this.game?.sound?.play('mob.ghast.fireball', { x: this.x, y: this.y, z: this.z, volume: 3 });
        const fb = new Fireball(this.world, this);
        const fx = -Math.sin(this.yaw) * 4;
        const fz = -Math.cos(this.yaw) * 4;
        fb.setPos(this.x + fx * 0.5, this.y + 2 - 0.5, this.z + fz * 0.5);
        fb.aim(target.x - fb.x, target.y + target.height / 2 - fb.y, target.z - fb.z);
        this.game.spawnEntity(fb);
        this.chargeTime = -40;
      }
    } else if (this.chargeTime > 0) this.chargeTime--;
    this.shooting = this.chargeTime > 10;
    if (!target) this.yaw = Math.atan2(-this.vx, -this.vz);
  }
  canMoveTo(dx, dy, dz, steps) {
    const b = this.aabb();
    for (let i = 1; i < steps; i++) {
      const test = [b[0] + dx * i, b[1] + dy * i, b[2] + dz * i, b[3] + dx * i, b[4] + dy * i, b[5] + dz * i];
      const list = this.world.getCollisions(test[0], test[1], test[2], test[3], test[4], test[5], []);
      for (const c of list) if (test[0] < c[3] && test[3] > c[0] && test[1] < c[4] && test[4] > c[1] && test[2] < c[5] && test[5] > c[2]) return false;
    }
    return true;
  }
  isInvulnerableTo(source) { return source.type === 'fire' || source.type === 'lava' || source.type === 'in_fire'; }
  hurt(source, amount) {
    // a deflected fireball one-shots ghasts
    if (source.type === 'explosion' && source.entity?.isPlayer) amount = 1000;
    return super.hurt(source, amount);
  }
  loot(killer, looting) { return [{ item: 'ghast_tear', count: rnd(0, 1 + looting) }, { item: 'gunpowder', count: rnd(0, 2 + looting) }]; }
}

// ---------------- blaze ----------------
export class Blaze extends Mob {
  constructor(world) {
    super(world, 'blaze');
    this.size(0.6, 1.8, 1.53);
    this.maxHealth = this.health = 20;
    this.hostile = true;
    this.xpReward = 10;
    this.followRange = 48;
    this.speed = 0.23;
    this.attackStep = 0; this.attackTime = 0;
    this.soundPrefix = 'blaze';
    this.nether = true;
    this.heightOffset = 0.5; this.heightTimer = 0;
  }
  playAmbient() { this.playSound('breathe'); }
  playSound(kind, vol = 1) {
    const map = { hurt: 'hit', death: 'death', say: 'breathe' };
    this.game?.sound?.play(`mob.blaze.${map[kind] ?? kind}`, { x: this.x, y: this.y + 1, z: this.z, volume: vol, pitch: (Math.random() - Math.random()) * 0.2 + 1 });
  }
  isInvulnerableTo(source) { return source.type === 'fire' || source.type === 'lava' || source.type === 'in_fire'; }
  setOnFire() {}
  aiStep() {
    // blazes hover: slow falling and rising toward the target's eye height
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
    if (this.inWater || (this.world.raining && this.world.canSeeSky(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z)))) {
      if (this.age % 20 === 0) this.hurt({ type: 'drown' }, 1);
    }
    if (Math.random() < 0.05) this.game?.fx?.smokeAt?.(this.x + (Math.random() - 0.5) * this.width, this.y + Math.random() * this.height, this.z + (Math.random() - 0.5) * this.width, true);
    super.aiStep();
  }
  onLand() {}
  think() {
    const p = this.game?.player;
    if (p && !p.dead && !p.creative && !p.spectator && this.distanceTo(p) < this.followRange && (this.target || this.canSee(p))) this.target = p;
    else if (this.target && (this.target.dead || this.target.creative)) this.target = null;
    const t = this.target;
    if (!t) { this.randomStroll(1, 60, 6); return; }
    this.lookAtEntity(t, 0.8);
    if (--this.heightTimer <= 0) { this.heightTimer = 100; this.heightOffset = 0.5 + Math.random() * 3; }
    if (this.y < t.y + t.eyeHeight + this.heightOffset && this.vy < 0.3) this.vy += (0.3 - this.vy) * 0.3;
    const d2 = this.distanceSq(t.x, t.y, t.z);
    this.attackTime--;
    if (d2 < 4) {
      if (this.attackTime <= 0) { this.attackTime = 20; this.swing(); t.hurt({ type: 'mob', entity: this, pos: [this.x, this.y, this.z] }, 6); t.setOnFire?.(4); }
      if (!this.navigating || this.age % 10 === 0) this.moveTo(t.x, t.y, t.z, 1);
    } else if (d2 < 48 * 48 && this.canSee(t)) {
      if (this.attackTime <= 0) {
        this.attackStep++;
        if (this.attackStep === 1) { this.attackTime = 60; this.onFireVisual = true; }
        else if (this.attackStep <= 4) this.attackTime = 6;
        else { this.attackTime = 100; this.attackStep = 0; this.onFireVisual = false; }
        if (this.attackStep > 1) {
          const spread = Math.sqrt(Math.sqrt(d2)) * 0.5;
          this.game?.sound?.play('mob.blaze.shoot', { x: this.x, y: this.y, z: this.z, pitch: 1 });
          const fb = new Fireball(this.world, this, true);
          fb.setPos(this.x, this.y + this.height / 2 + 0.5, this.z);
          fb.aim(t.x - this.x, t.y + t.height / 2 - fb.y, t.z - this.z, spread);
          this.game.spawnEntity(fb);
        }
      }
      if (this.age % 20 === 0) this.stopNav();
    } else if (!this.navigating || this.age % 20 === 0) this.moveTo(t.x, t.y, t.z, 1);
  }
  loot(killer, looting) { return killer ? [{ item: 'blaze_rod', count: rnd(0, 1 + looting) }] : []; }
}

// ---------------- magma cube ----------------
export class MagmaCube extends Mob {
  constructor(world, size = [1, 2, 4][Math.floor(Math.random() * 3)]) {
    super(world, 'magma_cube');
    this.cubeSize = size;
    this.applySize();
    this.hostile = true;
    this.soundPrefix = 'magmacube';
    this.jumpDelay = rnd(10, 30);
    this.squish = 0; this.oSquish = 0; this.targetSquish = 0;
    this.nether = true;
  }
  applySize() {
    const s = this.cubeSize;
    this.size(0.52 * s, 0.52 * s, 0.325 * s);
    this.maxHealth = this.health = s * s;
    this.xpReward = s;
    this.speed = 0.2 + 0.1 * s;
  }
  playAmbient() {}
  playSound(kind) {
    if (kind === 'say') return;
    this.game?.sound?.play(this.cubeSize > 1 ? 'mob.magmacube.big' : 'mob.magmacube.small', { x: this.x, y: this.y, z: this.z, volume: 0.4 * this.cubeSize, pitch: ((Math.random() - Math.random()) * 0.2 + 1) / (this.cubeSize > 1 ? 0.8 : 1.2) });
  }
  isInvulnerableTo(source) { return source.type === 'fire' || source.type === 'lava' || source.type === 'in_fire'; }
  setOnFire() {}
  armorValue() { return this.cubeSize * 3; }
  tick() {
    this.oSquish = this.squish;
    const wasOnGround = this.onGround;
    super.tick();
    this.squish += (this.targetSquish - this.squish) * 0.5;
    if (this.onGround && !wasOnGround && !this.dead) {
      this.targetSquish = -0.5;
      for (let i = 0; i < this.cubeSize * 4; i++) this.game?.fx?.flame?.(this.x + (Math.random() - 0.5) * this.width, this.y + 0.1, this.z + (Math.random() - 0.5) * this.width);
      this.game?.sound?.play('mob.magmacube.jump', { x: this.x, y: this.y, z: this.z, volume: 0.4 * this.cubeSize });
    } else if (!this.onGround && wasOnGround) this.targetSquish = 1;
    this.targetSquish *= 0.6;
  }
  serverAiStep() {
    this.jumping = false; this.moveForward = 0; this.moveStrafe = 0;
    const p = this.game?.player;
    const t = p && !p.dead && !p.creative && !p.spectator && this.distanceTo(p) < 16 && this.canSee(p) ? p : null;
    if (t) this.yaw += Math.max(-0.4, Math.min(0.4, wrapAngle(Math.atan2(-(t.x - this.x), -(t.z - this.z)) - this.yaw)));
    else if (Math.random() < 0.02) this.yaw += (Math.random() - 0.5) * 2;
    if (this.onGround) {
      if (--this.jumpDelay <= 0) {
        this.jumpDelay = rnd(10, 30) / (t ? 3 : 1);
        this.jumping = true;
        this.vy = 0.42 + 0.1 * this.cubeSize;
        const s = this.speed * (t ? 1.5 : 1);
        this.vx += -Math.sin(this.yaw) * s; this.vz += -Math.cos(this.yaw) * s;
      }
    } else { this.moveForward = this.speed; }
    if (t) {
      const b = this.aabb(), tb = t?.aabb();
      if (t && b[0] < tb[3] && b[3] > tb[0] && b[1] < tb[4] && b[4] > tb[1] && b[2] < tb[5] && b[5] > tb[2] && this.attackCooldown <= 0) {
        this.attackCooldown = 10;
        t.hurt({ type: 'mob', entity: this, pos: [this.x, this.y, this.z] }, this.cubeSize * 2 + (this.world.difficulty - 1));
        this.game?.sound?.play('mob.slime.attack', { x: this.x, y: this.y, z: this.z });
      }
    }
  }
  jumpFromGround() {}
  onDeath(source) {
    super.onDeath(source);
    if (this.cubeSize > 1) {
      const n = rnd(2, 4);
      for (let i = 0; i < n; i++) {
        const m = new MagmaCube(this.world, this.cubeSize / 2);
        m.setPos(this.x + (i % 2 - 0.5) * this.cubeSize / 4, this.y + 0.5, this.z + (Math.floor(i / 2) - 0.5) * this.cubeSize / 4);
        m.yaw = Math.random() * Math.PI * 2;
        this.game.spawnEntity(m);
      }
    }
  }
  loot(killer, looting) { return this.cubeSize > 1 ? [{ item: 'magma_cream', count: Math.random() < 0.25 + looting * 0.1 ? 1 : 0 }] : []; }
  extraData() { return { size: this.cubeSize }; }
  loadExtra(d) { this.cubeSize = d.size ?? 1; this.applySize(); }
}

MOB_TYPES.zombified_piglin = ZombifiedPiglin;
MOB_TYPES.ghast = Ghast;
MOB_TYPES.blaze = Blaze;
MOB_TYPES.magma_cube = MagmaCube;

export { ID_MASK, BlockById };
