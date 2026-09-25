// LivingEntity: health, damage, armor, effects and Minecraft 1.18 travel() physics.
import { Entity } from './entity.js';
import { ID_MASK } from '../constants.js';
import { BlockById } from '../registry/blocks.js';
import { wrapAngle } from '../util/math.js';

export const DamageTypes = {
  generic: { armor: true }, player: { armor: true, melee: true }, mob: { armor: true, melee: true },
  arrow: { armor: true, projectile: true }, fall: { armor: false }, lava: { armor: true, fire: true },
  fire: { armor: false, fire: true }, in_fire: { armor: true, fire: true }, hot_floor: { armor: false, fire: true }, drown: { armor: false }, starve: { armor: false },
  void: { armor: false, bypassInvul: true }, cactus: { armor: true }, explosion: { armor: true, explosion: true },
  magic: { armor: false }, wither: { armor: false }, suffocate: { armor: false }, kill: { armor: false, bypassInvul: true },
  thorns: { armor: true }, lightning: { armor: true, fire: true }, sweet_berry: { armor: true }, freeze: { armor: false },
};

export class LivingEntity extends Entity {
  constructor(world, type) {
    super(world, type);
    this.isLiving = true;
    this.maxHealth = 20;
    this.health = 20;
    this.absorption = 0;
    this.hurtTime = 0;
    this.hurtDuration = 10;
    this.invulnerableTime = 0;
    this.lastHurt = 0;
    this.deathTime = 0;
    this.dead = false;
    this.effects = new Map(); // id -> { amp, duration }
    this.moveForward = 0; this.moveStrafe = 0; this.jumping = false;
    this.noJumpDelay = 0;
    this.speed = 0.1;          // movement speed attribute
    this.flyingSpeed = 0.02;
    this.stepHeight = 0.6;
    this.knockbackResistance = 0;
    this.limbSwing = 0; this.limbSwingAmount = 0; this.prevLimbSwingAmount = 0;
    this.bodyYaw = 0; this.pbodyYaw = 0;
    this.headYaw = 0; this.pheadYaw = 0;
    this.swingTime = 0; this.swinging = false; this.swingDuration = 6;
    this.attackAnim = 0; this.pattackAnim = 0;
    this.lastHurtBy = null; this.lastHurtByTime = 0;
    this.air = 300; this.maxAir = 300;
    this.equipment = { mainhand: null, offhand: null, head: null, chest: null, legs: null, feet: null };
    this.sprinting = false;
    this.sneaking = false;
    this.flying = false;
    this.blocking = false;
    this.xpReward = 0;
    this.lastDamageSource = null;
  }

  isAlive() { return !this.dead && !this.removed; }

  // ---------- effects ----------
  addEffect(id, duration, amp = 0) {
    const e = this.effects.get(id);
    if (e && e.amp > amp) return;
    if (e && e.amp === amp && e.duration > duration) return;
    this.effects.set(id, { amp, duration });
    if (id === 'absorption') this.absorption = Math.max(this.absorption, (amp + 1) * 4);
    if (id === 'instant_health') { this.heal(4 << amp); this.effects.delete(id); }
    if (id === 'instant_damage') { this.hurt({ type: 'magic' }, 6 << amp); this.effects.delete(id); }
  }
  hasEffect(id) { return this.effects.has(id); }
  effectAmp(id) { const e = this.effects.get(id); return e ? e.amp : -1; }
  tickEffects() {
    for (const [id, e] of this.effects) {
      const amp = e.amp;
      switch (id) {
        case 'regeneration': { const k = 50 >> amp; if (k <= 0 || e.duration % k === 0) this.heal(1); break; }
        case 'poison': { const k = 25 >> amp; if ((k <= 0 || e.duration % k === 0) && this.health > 1) this.hurt({ type: 'magic' }, 1); break; }
        case 'wither': { const k = 40 >> amp; if (k <= 0 || e.duration % k === 0) this.hurt({ type: 'wither' }, 1); break; }
        default: break;
      }
      if (--e.duration <= 0) {
        this.effects.delete(id);
        if (id === 'absorption') this.absorption = 0;
      }
    }
  }

  heal(n) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  // ---------- armor ----------
  armorValue() {
    let a = 0;
    for (const k of ['head', 'chest', 'legs', 'feet']) { const s = this.equipment[k]; if (s && s.item?.armor) a += s.item.armor.points; }
    return a;
  }
  armorToughness() {
    let t = 0;
    for (const k of ['head', 'chest', 'legs', 'feet']) { const s = this.equipment[k]; if (s && s.item?.armor) t += s.item.armor.toughness; }
    return t;
  }
  protectionEPF(source) {
    let epf = 0;
    const t = DamageTypes[source.type] ?? {};
    for (const k of ['head', 'chest', 'legs', 'feet']) {
      const s = this.equipment[k];
      if (!s) continue;
      epf += s.enchantLevel?.('protection') ?? 0;
      if (t.fire) epf += 2 * (s.enchantLevel?.('fire_protection') ?? 0);
      if (source.type === 'fall' && k === 'feet') epf += 3 * (s.enchantLevel?.('feather_falling') ?? 0);
      if (t.explosion) epf += 2 * (s.enchantLevel?.('blast_protection') ?? 0);
      if (t.projectile) epf += 2 * (s.enchantLevel?.('projectile_protection') ?? 0);
    }
    return Math.min(20, epf);
  }

  // ---------- damage ----------
  isInvulnerableTo(source) { void source; return false; }

  canBlock(source) {
    if (!this.blocking || !source.pos) return false;
    const t = DamageTypes[source.type] ?? {};
    if (!t.melee && !t.projectile && !t.explosion) return false;
    const dx = source.pos[0] - this.x, dz = source.pos[2] - this.z;
    const lx = -Math.sin(this.yaw), lz = -Math.cos(this.yaw);
    return dx * lx + dz * lz > 0;
  }

  hurt(source, amount) {
    if (this.dead || this.removed) return false;
    const t = DamageTypes[source.type] ?? {};
    if (this.isInvulnerableTo(source) && !t.bypassInvul) return false;
    if (t.fire && this.hasEffect('fire_resistance')) return false;
    if (amount <= 0 && !source.entity) return false;
    let blocked = false;
    if (amount > 0 && this.canBlock(source)) {
      this.onShieldBlock(source, amount);
      amount = 0;
      blocked = true;
    }
    let tookFull = true;
    if (this.invulnerableTime > 10) {
      if (amount <= this.lastHurt) return false;
      this.actuallyHurt(source, amount - this.lastHurt);
      this.lastHurt = amount;
      tookFull = false;
    } else {
      this.lastHurt = amount;
      this.invulnerableTime = 20;
      this.actuallyHurt(source, amount);
      this.hurtDuration = 10;
      this.hurtTime = blocked ? 0 : 10;
    }
    this.lastDamageSource = source;
    if (source.entity) { this.lastHurtBy = source.entity; this.lastHurtByTime = 100; }
    if (tookFull && source.entity && !blocked && source.knockback !== false) {
      const dx = source.entity.x - this.x, dz = source.entity.z - this.z;
      this.knockback(0.4, dx, dz);
    } else if (tookFull && source.pos && !blocked && source.knockback !== false && t.projectile) {
      this.knockback(0.4, source.pos[0] - this.x, source.pos[2] - this.z);
    }
    if (tookFull && !blocked) this.onHurtEffects(source, amount);
    if (this.health <= 0 && !this.dead) this.die(source);
    return !blocked;
  }

  onShieldBlock(source, amount) { void source; void amount; }
  onHurtEffects(source, amount) { void source; void amount; }

  actuallyHurt(source, amount) {
    const t = DamageTypes[source.type] ?? {};
    if (t.armor) {
      const armor = this.armorValue(), tough = this.armorToughness();
      const f = Math.min(20, Math.max(armor / 5, armor - amount / (2 + tough / 4)));
      amount = amount * (1 - f / 25);
      this.damageArmor(source, amount);
    }
    const res = this.effectAmp('resistance');
    if (res >= 0 && source.type !== 'void' && source.type !== 'kill') amount = amount * Math.max(0, 1 - (res + 1) * 0.2);
    const epf = this.protectionEPF(source);
    if (epf > 0) amount = amount * (1 - epf / 25);
    if (amount <= 0) return;
    const absorbed = Math.min(this.absorption, amount);
    this.absorption -= absorbed;
    amount -= absorbed;
    if (amount > 0) this.health = Math.max(0, this.health - amount);
    this.onDamageTaken(source, amount + absorbed);
  }

  onDamageTaken(source, amount) { void source; void amount; }
  damageArmor(source, amount) { void source; void amount; }

  knockback(strength, dx, dz) {
    strength *= 1 - this.knockbackResistance;
    if (strength <= 0) return;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; l = Math.hypot(dx, dz); }
    dx /= l; dz /= l;
    this.vx = this.vx / 2 - dx * strength;
    this.vz = this.vz / 2 - dz * strength;
    if (this.onGround) this.vy = Math.min(0.4, this.vy / 2 + strength);
  }

  die(source) {
    this.dead = true;
    this.health = 0;
    this.deathTime = 0;
    this.onDeath(source);
  }
  onDeath(source) { void source; }

  swing() {
    if (!this.swinging || this.swingTime >= this.swingDuration / 2 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
    }
  }
  updateSwing() {
    this.pattackAnim = this.attackAnim;
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= this.swingDuration) { this.swingTime = 0; this.swinging = false; }
    } else this.swingTime = 0;
    this.attackAnim = this.swingTime / this.swingDuration;
  }

  // ---------- per tick ----------
  tick() {
    this.baseTick();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.lastHurtByTime > 0 && --this.lastHurtByTime === 0) this.lastHurtBy = null;
    if (this.dead) {
      this.deathTime++;
      if (this.deathTime >= 20) this.onDeathAnimationDone();
      this.vx *= 0.9; this.vz *= 0.9;
      if (!this.onGround) this.vy -= 0.08;
      this.move(this.vx, this.vy, this.vz);
      return;
    }
    this.tickEffects();
    this.environmentDamage();
    this.aiStep();
    this.updateSwing();
    // body rotation follows movement
    this.pbodyYaw = this.bodyYaw; this.pheadYaw = this.headYaw;
    const mdx = this.x - this.px, mdz = this.z - this.pz;
    const distMoved = mdx * mdx + mdz * mdz;
    let target = this.bodyYaw;
    if (distMoved > 0.0025) target = Math.atan2(-mdx, -mdz);
    if (this.attackAnim > 0) target = this.yaw;
    this.bodyYaw += wrapAngle(target - this.bodyYaw) * 0.3;
    // vanilla tickHeadTurn: head at most 75 degrees from the body, body drifts to within 50 degrees
    let rel = wrapAngle(this.yaw - this.bodyYaw);
    if (rel < -1.309) rel = -1.309; else if (rel > 1.309) rel = 1.309;
    this.bodyYaw = this.yaw - rel;
    if (rel * rel > 0.7615) this.bodyYaw += rel * 0.2;
    this.headYaw = this.yaw;
    // limb animation
    this.prevLimbSwingAmount = this.limbSwingAmount;
    let dist = Math.sqrt(distMoved) * 4;
    if (dist > 1) dist = 1;
    this.limbSwingAmount += (dist - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
  }

  onDeathAnimationDone() { this.remove(); }

  environmentDamage() {
    // suffocation
    if (this.age % 10 === 0 && this.isInsideOpaque() && !this.noPhysics) this.hurt({ type: 'suffocate' }, 1);
    // drowning
    if (this.eyeInWater && !this.canBreatheUnderwater()) {
      const resp = this.equipment.head?.enchantLevel?.('respiration') ?? 0;
      if (resp === 0 || Math.random() < 1 / (resp + 1)) this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.hurt({ type: 'drown' }, 2);
      }
    } else if (this.air < this.maxAir) this.air = Math.min(this.maxAir, this.air + 4);
    // lava / fire
    if (this.inLava) {
      this.setOnFire(15);
      this.hurt({ type: 'lava' }, 4);
    }
    if (this.fireTicks > 0 && this.fireTicks % 20 === 0 && !this.inLava) this.hurt({ type: 'fire' }, 1);
    // blocks that damage on contact (cactus, sweet berry bush, fire)
    if (this.age % 2 === 0) this.checkContactDamage();
  }

  canBreatheUnderwater() { return this.hasEffect('water_breathing'); }

  setOnFire(seconds) {
    if (this.hasEffect('fire_resistance')) return;
    this.fireTicks = Math.max(this.fireTicks, seconds * 20);
  }

  checkContactDamage() {
    const [x0, y0, z0, x1, y1, z1] = this.aabb(0.001);
    const w = this.world;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
          const def = BlockById[w.getBlock(x, y, z) & ID_MASK];
          if (def.damageOnTouch) { this.hurt({ type: 'cactus' }, def.damageOnTouch); return; }
          if (def.name === 'fire') { this.setOnFire(8); this.hurt({ type: 'in_fire' }, 1); return; }
          if (def.berry && (this.vx * this.vx + this.vz * this.vz) > 0.0001 && this.type !== 'fox') {
            this.hurt({ type: 'sweet_berry' }, 1); return;
          }
        }
  }

  // magma blocks burn anything standing on them that isn't sneaking or fire-immune
  checkHotFloor() {
    if (!this.onGround || this.sneaking || this.dead || this.isInvulnerableTo({ type: 'fire' })) return;
    const v = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
    if (BlockById[v & ID_MASK].hotFloor && !this.hasEffect('fire_resistance')) {
      const boots = this.equipment?.feet;
      if (boots?.enchantLevel?.('frost_walker') > 0) return;
      this.hurt({ type: 'hot_floor' }, 1);
    }
  }

  aiStep() {
    if (this.noJumpDelay > 0) this.noJumpDelay--;
    this.checkHotFloor();
    // tiny velocities snap to zero
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vy) < 0.003) this.vy = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
    this.serverAiStep();
    let fwd = this.moveForward * 0.98, str = this.moveStrafe * 0.98;
    if (this.jumping && !this.flying) {
      const inFluid = this.inWater || this.inLava;
      if (inFluid && (!this.onGround || this.waterHeight > 0.4)) {
        this.vy += 0.04; // swim up
      } else if (this.onGround && this.noJumpDelay === 0) {
        this.jumpFromGround();
        this.noJumpDelay = 10;
      }
    } else this.noJumpDelay = 0;
    this.travel(str, fwd);
  }

  serverAiStep() {}

  jumpPower() { return 0.42 * this.blockJumpFactor(); }
  blockJumpFactor() {
    const v = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
    return BlockById[v & ID_MASK].name === 'honey_block' ? 0.5 : 1;
  }
  jumpFromGround() {
    let jv = this.jumpPower();
    const jb = this.effectAmp('jump_boost');
    if (jb >= 0) jv += 0.1 * (jb + 1);
    this.vy = jv;
    if (this.sprinting) {
      this.vx += -Math.sin(this.yaw) * 0.2;
      this.vz += -Math.cos(this.yaw) * 0.2;
    }
    this.onJump();
  }
  onJump() {}

  effectiveSpeed() {
    let s = this.speed;
    if (this.sprinting) s *= 1.3;
    const sp = this.effectAmp('speed');
    if (sp >= 0) s *= 1 + 0.2 * (sp + 1);
    const sl = this.effectAmp('slowness');
    if (sl >= 0) s *= Math.max(0, 1 - 0.15 * (sl + 1));
    return s;
  }

  moveRelative(speed, strafe, forward) {
    let l = strafe * strafe + forward * forward;
    if (l < 1e-7) return;
    l = Math.sqrt(l);
    if (l < 1) l = 1;
    strafe = strafe / l * speed; forward = forward / l * speed;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    this.vx += -s * forward + c * strafe;
    this.vz += -c * forward - s * strafe;
  }

  onClimbable() {
    const def = BlockById[this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) & ID_MASK];
    return !!def.climbable;
  }

  // soul sand etc: block at the feet, else the block just below (Entity.getBlockSpeedFactor)
  blockSpeedFactor() {
    if (this.flying) return 1;
    const w = this.world, x = Math.floor(this.x), z = Math.floor(this.z);
    const at = BlockById[w.getBlock(x, Math.floor(this.y), z) & ID_MASK];
    if (at.liquid) return 1;
    if (at.speedFactor) return at.speedFactor;
    return BlockById[w.getBlock(x, Math.floor(this.y - 0.5000001), z) & ID_MASK].speedFactor ?? 1;
  }

  blockFriction() {
    const v = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5000001), Math.floor(this.z));
    const def = BlockById[v & ID_MASK];
    return def.slip ?? 0.6;
  }

  travel(strafe, forward) {
    const gravity = this.noGravity ? 0 : (this.vy <= 0 && this.hasEffect('slow_falling') ? 0.01 : 0.08);
    if (this.inWater && !this.flying) {
      const y0 = this.y;
      let drag = this.sprinting ? 0.9 : 0.8;
      let speed = 0.02;
      const ds = this.equipment.feet?.enchantLevel?.('depth_strider') ?? 0;
      if (ds > 0) { const k = Math.min(3, ds) / 3 * (this.onGround ? 1 : 0.5); drag += (0.546 - drag) * k; speed += (this.effectiveSpeed() - speed) * k; }
      this.moveRelative(speed, strafe, forward);
      this.move(this.vx, this.vy, this.vz);
      if (this.horizontalCollision && this.onClimbable()) this.vy = 0.2;
      this.vx *= drag; this.vy *= 0.8; this.vz *= drag;
      if (gravity > 0 && !this.sprinting) this.vy -= gravity / 16;
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else if (this.inLava && !this.flying) {
      const y0 = this.y;
      this.moveRelative(0.02, strafe, forward);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5;
      if (gravity > 0) this.vy -= gravity / 4;
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else {
      const f2 = this.blockFriction();
      const f3 = this.onGround ? f2 * 0.91 : 0.91;
      const speed = this.onGround ? this.effectiveSpeed() * (0.21600002 / (f2 * f2 * f2)) : this.flyingSpeedNow();
      this.moveRelative(speed, strafe, forward);
      const climbing = this.onClimbable() && !this.flying;
      if (climbing) {
        this.fallDistance = 0;
        this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
        this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
        this.vy = Math.max(this.vy, -0.15);
        if (this.vy < 0 && this.sneaking && this.isPlayer) this.vy = 0;
      }
      this.move(this.vx, this.vy, this.vz);
      const sf = this.blockSpeedFactor();
      if (sf !== 1) { this.vx *= sf; this.vz *= sf; }
      if ((this.horizontalCollision || this.jumping) && climbing) this.vy = 0.2;
      let vy = this.vy;
      const lev = this.effectAmp('levitation');
      if (lev >= 0) vy += (0.05 * (lev + 1) - vy) * 0.2;
      else vy -= gravity;
      this.vx *= f3; this.vy = vy * 0.98; this.vz *= f3;
    }
  }

  flyingSpeedNow() { return this.flyingSpeed; }

  isFree(dx, dy, dz) {
    const b = this.aabb();
    const test = [b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz];
    const list = this.world.getCollisions(test[0], test[1], test[2], test[3], test[4], test[5], []);
    for (const c of list) {
      if (test[0] < c[3] && test[3] > c[0] && test[1] < c[4] && test[4] > c[1] && test[2] < c[5] && test[5] > c[2]) return false;
    }
    return !this.world.containsLiquid(test[0], test[1], test[2], test[3], test[4], test[5], 0);
  }

  onLand(distance) {
    const jb = this.effectAmp('jump_boost');
    const dmg = Math.ceil(distance - 3 - (jb >= 0 ? jb + 1 : 0));
    if (dmg > 0 && !this.hasEffect('slow_falling')) {
      const below = BlockById[this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z)) & ID_MASK];
      let d = dmg;
      if (below.name === 'hay_block') d = Math.ceil(d * 0.2);
      if (below.name === 'red_bed') d = Math.ceil(d * 0.5);
      if (d > 0 && !this.inWater) this.hurt({ type: 'fall' }, d);
      this.game?.fx?.landingParticles?.(this, dmg);
    }
  }

  get game() { return this.world.game; }
}
