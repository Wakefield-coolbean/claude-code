// The player entity: survival stats, abilities, inventory, attack cooldown and item use.
import { LivingEntity } from './living.js';
import { PlayerInventory, ItemStack, OFFHAND, ARMOR_SLOT_INDEX } from '../game/inventory.js';

export class FoodData {
  constructor() { this.food = 20; this.saturation = 5; this.exhaustion = 0; this.timer = 0; this.lastFood = 20; }
  eat(hunger, sat) {
    this.food = Math.min(20, this.food + hunger);
    this.saturation = Math.min(this.food, this.saturation + hunger * sat * 2);
  }
  addExhaustion(e) { this.exhaustion = Math.min(40, this.exhaustion + e); }
  tick(player) {
    const diff = player.world.difficulty;
    this.lastFood = this.food;
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (diff !== 0) this.food = Math.max(0, this.food - 1);
    }
    const regen = player.world.gamerules.naturalRegeneration;
    const hurt = player.health > 0 && player.health < player.maxHealth;
    if (regen && this.saturation > 0 && hurt && this.food >= 20) {
      if (++this.timer >= 10) {
        const f = Math.min(this.saturation, 6);
        player.heal(f / 6);
        this.addExhaustion(f);
        this.timer = 0;
      }
    } else if (regen && this.food >= 18 && hurt) {
      if (++this.timer >= 80) { player.heal(1); this.addExhaustion(6); this.timer = 0; }
    } else if (this.food <= 0) {
      if (++this.timer >= 80) {
        if (player.health > 10 || diff === 3 || (player.health > 1 && diff === 2)) player.hurt({ type: 'starve' }, 1);
        this.timer = 0;
      }
    } else this.timer = 0;
  }
  serialize() { return [this.food, this.saturation, this.exhaustion]; }
  deserialize(a) { if (a) [this.food, this.saturation, this.exhaustion] = a; }
}

export function xpForLevel(level) {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

export class Player extends LivingEntity {
  constructor(world) {
    super(world, 'player');
    this.isPlayer = true;
    this.width = 0.6; this.height = 1.8;
    this.eyeHeight = 1.62;
    this.inventory = new PlayerInventory();
    this.food = new FoodData();
    this.gamemode = 'survival';
    this.abilities = { mayfly: false, flying: false, instabuild: false, invulnerable: false, flySpeed: 0.05, walkSpeed: 0.1 };
    this.xpLevel = 0; this.xpProgress = 0; this.xpTotal = 0;
    this.attackStrengthTicker = 0;
    this.useItem = null; this.useTicks = 0; this.useHand = 'main';
    this.bob = 0; this.oBob = 0; this.walkDist = 0; this.walkDistO = 0;
    this.spawnPoint = null;       // bed spawn
    this.sleeping = false; this.sleepTimer = 0; this.bedPos = null;
    this.sprintTriggerTime = 0;
    this.jumpTriggerTime = 0;
    this.input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    this.hurtDir = 0;
    this.shieldCooldown = 0;
    this.lastSelected = 0;
    this.score = 0;
    this.enchantSeed = (Math.random() * 1e9) | 0;
    this.stepDistance = 0; this.nextStep = 1;
    this.portalTime = 0;
    this.speed = 0.1;
    this.bedSpawnForced = false;
  }

  get survivalLike() { return this.gamemode === 'survival' || this.gamemode === 'adventure'; }
  get creative() { return this.gamemode === 'creative'; }
  get spectator() { return this.gamemode === 'spectator'; }

  setGamemode(mode) {
    this.gamemode = mode;
    const a = this.abilities;
    a.instabuild = mode === 'creative';
    a.mayfly = mode === 'creative' || mode === 'spectator';
    a.invulnerable = mode === 'creative' || mode === 'spectator';
    if (!a.mayfly) a.flying = false;
    if (mode === 'spectator') a.flying = true;
    this.noPhysics = mode === 'spectator';
    this.flying = a.flying;
  }

  // equipment is backed by the inventory
  syncEquipment() {
    const inv = this.inventory;
    this.equipment.mainhand = inv.held;
    this.equipment.offhand = inv.slots[OFFHAND];
    this.equipment.head = inv.slots[ARMOR_SLOT_INDEX.head];
    this.equipment.chest = inv.slots[ARMOR_SLOT_INDEX.chest];
    this.equipment.legs = inv.slots[ARMOR_SLOT_INDEX.legs];
    this.equipment.feet = inv.slots[ARMOR_SLOT_INDEX.feet];
  }

  isInvulnerableTo(source) {
    if (this.abilities.invulnerable && source.type !== 'void' && source.type !== 'kill') return true;
    return false;
  }

  // ---------- attack cooldown (1.9 combat) ----------
  attackSpeed() {
    const it = this.inventory.held?.item;
    let s = it?.attackSpeed ?? 4;
    const haste = this.effectAmp('haste');
    if (haste >= 0) s *= 1 + 0.1 * (haste + 1);
    const fat = this.effectAmp('mining_fatigue');
    if (fat >= 0) s *= 1 - 0.1 * (fat + 1);
    return s;
  }
  attackCooldownTicks() { return 20 / this.attackSpeed(); }
  attackStrength(partial = 0) {
    return Math.max(0, Math.min(1, (this.attackStrengthTicker + partial) / this.attackCooldownTicks()));
  }
  resetAttackStrength() { this.attackStrengthTicker = 0; }

  attackDamage() {
    const it = this.inventory.held?.item;
    let d = it?.damage ?? 1;
    const str = this.effectAmp('strength');
    if (str >= 0) d += 3 * (str + 1);
    const weak = this.effectAmp('weakness');
    if (weak >= 0) d -= 4 * (weak + 1);
    return Math.max(0, d);
  }

  // ---------- xp ----------
  giveXp(amount) {
    this.score += amount;
    this.xpTotal += amount;
    this.xpProgress += amount / xpForLevel(this.xpLevel);
    let leveled = false;
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * xpForLevel(this.xpLevel);
      this.xpLevel++;
      this.xpProgress /= xpForLevel(this.xpLevel);
      leveled = true;
    }
    if (leveled && this.xpLevel % 5 === 0) this.game?.sound?.play('random.levelup', { volume: 0.75 });
    return leveled;
  }
  giveLevels(n) {
    this.xpLevel = Math.max(0, this.xpLevel + n);
    if (this.xpLevel === 0) this.xpProgress = 0;
  }

  // ---------- exhaustion helper ----------
  exhaust(e) { if (this.survivalLike) this.food.addExhaustion(e); }

  // ---------- item use (eating, bows, shields) ----------
  startUsing(hand) {
    const stack = hand === 'off' ? this.inventory.offhand : this.inventory.held;
    if (!stack) return false;
    this.useItem = stack;
    this.useHand = hand;
    this.useTicks = 0;
    return true;
  }
  stopUsing() {
    this.useItem = null; this.useTicks = 0; this.blocking = false;
  }
  get isUsingItem() { return !!this.useItem; }

  // ---------- movement ----------
  flyingSpeedNow() {
    if (this.abilities.flying) return this.abilities.flySpeed * (this.sprinting ? 2 : 1);
    return this.sprinting ? 0.026 : 0.02;
  }

  canSprint() {
    return (this.food.food > 6 || this.abilities.mayfly) && !this.isUsingItem && !this.hasEffect('blindness');
  }

  serverAiStep() {
    const inp = this.input;
    let fwd = inp.forward, str = inp.strafe;
    // sneaking or using an item slows you
    if (this.sneaking && !this.abilities.flying) { fwd *= 0.3; str *= 0.3; }
    if (this.isUsingItem) { fwd *= 0.2; str *= 0.2; }
    this.moveForward = fwd; this.moveStrafe = str;
    this.jumping = inp.jump;
    if (this.abilities.flying) {
      let vy = 0;
      if (inp.sneak) vy -= this.abilities.flySpeed * 3;
      if (inp.jump) vy += this.abilities.flySpeed * 3;
      this.vy += vy;
    }
  }

  travel(strafe, forward) {
    if (this.abilities.flying && !this.spectator) {
      const vy = this.vy;
      super.travel(strafe, forward);
      this.vy = vy * 0.6;
      this.fallDistance = 0;
      if (this.onGround && !this.spectator) { this.abilities.flying = false; this.flying = false; }
    } else if (this.spectator) {
      const vy = this.vy;
      this.moveRelative(this.flyingSpeedNow(), strafe, forward);
      this.x += this.vx; this.y += this.vy; this.z += this.vz;
      this.vx *= 0.91; this.vz *= 0.91; this.vy = vy * 0.6;
      this.onGround = false;
    } else super.travel(strafe, forward);
  }

  tick() {
    this.syncEquipment();
    const inp = this.input;
    this.flying = this.abilities.flying;
    // sneaking & pose
    const wantSneak = inp.sneak && !this.abilities.flying && !this.sleeping;
    this.sneaking = wantSneak;
    this.preventEdgeFall = this.sneaking && !this.abilities.flying;
    const h = this.sneaking ? 1.5 : 1.8;
    if (h !== this.height) {
      if (h > this.height) {
        // only stand up if there is room
        const b = this.aabb();
        const list = this.world.getCollisions(b[0], b[1], b[2], b[3], b[1] + 1.8, b[5], []);
        let free = true;
        for (const c of list) if (b[0] < c[3] && b[3] > c[0] && b[1] < c[4] && b[1] + 1.8 > c[1] && b[2] < c[5] && b[5] > c[2]) free = false;
        if (free) this.height = h;
        else this.sneaking = true;
      } else this.height = h;
    }
    this.eyeHeight = this.sneaking ? 1.27 : 1.62;
    // sprinting
    if (this.sprinting) {
      if (inp.forward <= 0 || !this.canSprint() || this.horizontalCollision && !this.inWater || this.sneaking && !this.inWater) this.sprinting = false;
    } else if (inp.sprint && inp.forward > 0 && this.canSprint() && !this.sneaking) this.sprinting = true;
    if (this.sprinting && this.inWater && !this.eyeInWater && inp.forward <= 0) this.sprinting = false;

    if (this.shieldCooldown > 0) this.shieldCooldown--;
    this.attackStrengthTicker++;
    if (this.inventory.selected !== this.lastSelected) {
      this.lastSelected = this.inventory.selected;
      this.resetAttackStrength();
      if (this.useItem && this.useHand === 'main') this.stopUsing();
    }
    const wx = this.x, wz = this.z;
    super.tick();
    if (this.dead) return;
    // walk distance / bob
    const dx = this.x - wx, dz = this.z - wz;
    const hd = Math.hypot(dx, dz);
    this.walkDistO = this.walkDist;
    this.oBob = this.bob;
    if (!this.abilities.flying) this.walkDist += hd * 0.6;
    const target = this.onGround && !this.dead ? Math.min(0.1, hd) : 0;
    this.bob += (target - this.bob) * 0.4;
    // footsteps
    if (this.onGround && !this.sneaking) this.stepDistance += hd;
    else if (this.onGround && this.sneaking) this.stepDistance += hd * 0.4;
    if (this.stepDistance > this.nextStep && this.onGround) {
      this.nextStep = this.stepDistance + 1.7;
      this.game?.fx?.footstep?.(this);
    }
    if (this.inWater && hd > 0.01 && this.age % 12 === 0) this.game?.sound?.play('random.swim', { x: this.x, y: this.y, z: this.z, volume: 0.25, pitch: 1 + (Math.random() - 0.5) * 0.4 });
    // exhaustion
    if (this.survivalLike) {
      const dist = Math.hypot(dx, this.y - this.py, dz);
      if (this.inWater && this.eyeInWater) this.food.addExhaustion(0.01 * dist);
      else if (this.inWater) this.food.addExhaustion(0.01 * hd);
      else if (this.onGround && this.sprinting) this.food.addExhaustion(0.1 * hd);
      this.food.tick(this);
    }
    if (this.abilities.invulnerable) { this.air = this.maxAir; }
    // using items
    if (this.useItem) {
      const cur = this.useHand === 'off' ? this.inventory.offhand : this.inventory.held;
      if (cur !== this.useItem) this.stopUsing();
      else this.useTicks++;
    }
    this.blocking = !!(this.useItem && this.useItem.item?.use === 'shield' && this.useTicks >= 5 && this.shieldCooldown === 0);
  }

  onJump() {
    this.exhaust(this.sprinting ? 0.2 : 0.05);
  }

  onLand(distance) {
    if (this.abilities.mayfly || this.spectator) return;
    super.onLand(distance);
  }

  onVoid() { this.hurt({ type: 'void' }, 4); }

  damageArmor(source, amount) {
    if (source.type === 'fire' || source.type === 'drown' || source.type === 'starve' || source.type === 'fall') return;
    const dmg = Math.max(1, Math.floor(amount / 4));
    for (const slot of ['head', 'chest', 'legs', 'feet']) {
      const idx = ARMOR_SLOT_INDEX[slot];
      const s = this.inventory.slots[idx];
      if (s && s.item?.armor) {
        if (s.hurt(dmg)) {
          this.inventory.set(idx, null);
          this.game?.sound?.play('random.break', { x: this.x, y: this.y, z: this.z });
        }
      }
    }
  }

  onShieldBlock(source, amount) {
    const hand = this.useHand === 'off' ? 'off' : 'main';
    const stack = hand === 'off' ? this.inventory.offhand : this.inventory.held;
    this.game?.sound?.play('item.shield.block', { x: this.x, y: this.y, z: this.z, pitch: 0.8 + Math.random() * 0.4 });
    if (stack && amount >= 3) {
      const dmg = 1 + Math.floor(amount);
      if (stack.hurt(dmg)) {
        if (hand === 'off') this.inventory.set(OFFHAND, null); else this.inventory.held = null;
        this.stopUsing();
        this.game?.sound?.play('random.break', { x: this.x, y: this.y, z: this.z });
      }
    }
    // melee attackers get knocked back
    if (source.entity && source.melee !== false && DamageMelee(source)) {
      source.entity.knockback?.(0.5, this.x - source.entity.x, this.z - source.entity.z);
    }
    // axes disable shields
    if (source.entity?.equipment?.mainhand?.item?.tool?.type === 'axe') this.disableShield();
  }

  disableShield() {
    this.shieldCooldown = 100;
    this.stopUsing();
    this.game?.sound?.play('item.shield.break', { x: this.x, y: this.y, z: this.z });
  }

  onHurtEffects(source, amount) {
    const e = source.entity;
    this.hurtDir = e ? Math.atan2(e.z - this.z, e.x - this.x) - this.yaw : 0;
    this.exhaust(0.1);
    this.game?.onPlayerHurt?.(this, source, amount);
  }

  onDeath(source) {
    this.game?.onPlayerDeath?.(this, source);
  }

  onDeathAnimationDone() { /* player stays until respawn */ }

  respawn(pos) {
    this.dead = false;
    this.removed = false;
    this.health = this.maxHealth;
    this.food = new FoodData();
    this.air = this.maxAir;
    this.fireTicks = 0;
    this.effects.clear();
    this.absorption = 0;
    this.deathTime = 0;
    this.hurtTime = 0;
    this.fallDistance = 0;
    this.vx = this.vy = this.vz = 0;
    this.setPos(pos.x, pos.y, pos.z);
    this.stopUsing();
  }

  serialize() {
    return {
      ...super.serialize(),
      health: this.health, food: this.food.serialize(), xp: [this.xpLevel, this.xpProgress, this.xpTotal], air: this.air,
      inv: this.inventory.serialize(), selected: this.inventory.selected, gamemode: this.gamemode,
      flying: this.abilities.flying, spawn: this.spawnPoint, effects: [...this.effects], absorption: this.absorption,
      score: this.score, seed: this.enchantSeed,
    };
  }
  deserialize(d) {
    super.deserialize(d);
    this.health = d.health ?? 20;
    this.food.deserialize(d.food);
    if (d.xp) [this.xpLevel, this.xpProgress, this.xpTotal] = d.xp;
    this.air = d.air ?? 300;
    this.inventory.deserialize(d.inv);
    this.inventory.selected = d.selected ?? 0;
    this.setGamemode(d.gamemode ?? 'survival');
    this.abilities.flying = !!d.flying && this.abilities.mayfly;
    this.spawnPoint = d.spawn ?? null;
    this.effects = new Map(d.effects ?? []);
    this.absorption = d.absorption ?? 0;
    this.score = d.score ?? 0;
    this.enchantSeed = d.seed ?? this.enchantSeed;
  }
}

function DamageMelee(source) { return source.type === 'mob' || source.type === 'player'; }

export { ItemStack };
