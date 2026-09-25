// Player interaction: mining (with vanilla break times), placing, using items, attacking (1.9 combat).
import { ID_MASK, packBlock, MIN_Y, MAX_Y } from '../constants.js';
import { BlockById, B, Blocks } from '../registry/blocks.js';
import { ItemById, Items } from '../registry/items.js';
import { getCollisionBoxes } from '../registry/shapes.js';
import { raycastBlocks, rayBox, FACE_OFFSETS } from './raycast.js';
import { ItemStack, OFFHAND, ARMOR_SLOT_INDEX } from './inventory.js';
import { SB_ALL } from '../world/world.js';
import { tryLightPortal } from './portal.js';

const idOf = (v) => v & ID_MASK;

export class Interaction {
  constructor(game) {
    this.game = game;
    this.target = null;        // block hit
    this.targetEntity = null;  // entity hit
    this.breaking = null;      // { x, y, z, progress, ticks }
    this.destroyDelay = 0;
    this.useDelay = 0;
    this.leftWasDown = false;
    this.rightWasDown = false;
    this.handSwingEquip = 0;
  }
  get world() { return this.game.world; }
  get player() { return this.game.player; }

  reach() { return this.player.creative ? 5 : 4.5; }

  lookVector() {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  }

  updateTarget() {
    const p = this.player;
    if (!p || p.dead || p.spectator) { this.target = null; this.targetEntity = null; return; }
    const [dx, dy, dz] = this.lookVector();
    const ox = p.x, oy = p.y + p.eyeHeight, oz = p.z;
    const reach = this.reach();
    const hit = raycastBlocks(this.world, ox, oy, oz, dx, dy, dz, reach);
    let blockDist = hit ? hit.dist : reach;
    // entities
    let best = null, bestT = Math.min(blockDist, p.creative ? 5 : 3);
    for (const e of this.game.entities.list) {
      if (e === p || e.removed || !e.pickable || e.dead) continue;
      if (e.distanceSq(ox, oy, oz) > 64) continue;
      const pr = 0.1;
      const b = e.aabb(pr);
      const r = rayBox(ox, oy, oz, dx, dy, dz, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (r && r.t < bestT) { bestT = r.t; best = e; }
    }
    this.targetEntity = best;
    this.target = best ? null : hit;
  }

  // ---------- per tick ----------
  tick(input, uiOpen) {
    const p = this.player;
    if (!p || p.dead) { this.breaking = null; return; }
    if (this.destroyDelay > 0) this.destroyDelay--;
    if (this.useDelay > 0) this.useDelay--;
    const left = !uiOpen && input.mouse[0];
    const right = !uiOpen && input.mouse[2];
    const leftPressed = left && !this.leftWasDown;
    const rightPressed = right && !this.rightWasDown;
    this.leftWasDown = left; this.rightWasDown = right;
    if (p.spectator) return;

    // releasing right mouse finishes bows / stops shields & eating
    if (!right && p.isUsingItem) this.releaseUsing();
    if (p.isUsingItem) this.tickUsing();

    // attacking / mining
    if (leftPressed) {
      if (this.targetEntity) {
        this.attack(this.targetEntity);
      } else if (!this.target) {
        p.swing();
        p.resetAttackStrength();
      }
    }
    if (left && this.target && !p.isUsingItem) this.continueDestroy(this.target, leftPressed);
    else this.stopDestroy();

    // using / placing
    if (right && !p.isUsingItem && this.useDelay === 0 && !left) {
      if (rightPressed || this.useDelay === 0) {
        this.useItemOrBlock();
      }
    }
  }

  // ---------- mining ----------
  destroySpeed(def, stack) {
    const p = this.player;
    const it = stack?.item;
    let f = 1;
    if (it?.tool) {
      const t = it.tool;
      if (t.type === def.tool) f = t.speed;
      else if (t.type === 'sword' && def.name === 'cobweb') f = 15;
      else if (t.type === 'sword' && (def.leaves || def.render === 'cross' || def.name === 'pumpkin' || def.name === 'melon')) f = 1.5;
      else if (t.type === 'shears') {
        if (def.leaves || def.name === 'cobweb') f = 15;
        else if (def.name.endsWith('_wool')) f = 5;
        else if (def.render === 'cross') f = 2;
      }
    }
    if (f > 1 && stack) {
      const eff = stack.enchantLevel('efficiency');
      if (eff > 0) f += eff * eff + 1;
    }
    const haste = p.effectAmp('haste');
    if (haste >= 0) f *= 1 + (haste + 1) * 0.2;
    const fat = p.effectAmp('mining_fatigue');
    if (fat >= 0) f *= [0.3, 0.09, 0.0027, 0.00081][Math.min(3, fat)];
    if (p.eyeInWater && !(p.equipment.head?.enchantLevel?.('aqua_affinity') > 0)) f /= 5;
    if (!p.onGround && !p.abilities.flying) f /= 5;
    return f;
  }

  canHarvest(def, stack) {
    if (!def.needsTool) return true;
    const t = stack?.item?.tool;
    if (!t) return false;
    if (def.name === 'cobweb') return t.type === 'sword' || t.type === 'shears';
    if (def.name === 'snow' || def.name === 'snow_block') return t.type === 'shovel';
    return t.type === def.tool && t.tier >= def.tier;
  }

  destroyProgressPerTick(def, stack) {
    if (def.hardness < 0) return 0;
    if (def.hardness === 0) return 1;
    return this.destroySpeed(def, stack) / def.hardness / (this.canHarvest(def, stack) ? 30 : 100);
  }

  continueDestroy(hit, justPressed) {
    const p = this.player;
    const w = this.world;
    const v = w.getBlock(hit.x, hit.y, hit.z);
    const def = BlockById[idOf(v)];
    if (v === 0 || def.liquid) { this.stopDestroy(); return; }
    if (p.gamemode === 'adventure') { this.stopDestroy(); return; }
    if (p.creative) {
      if (this.destroyDelay > 0) return;
      const held = p.inventory.held;
      if (held?.item?.tool?.type === 'sword') return; // swords can't break blocks in creative
      p.swing();
      this.destroyBlock(hit.x, hit.y, hit.z);
      this.destroyDelay = 5;
      return;
    }
    if (this.destroyDelay > 0 && !justPressed) return;
    const b = this.breaking;
    if (!b || b.x !== hit.x || b.y !== hit.y || b.z !== hit.z || b.v !== v) {
      this.breaking = { x: hit.x, y: hit.y, z: hit.z, v, progress: 0, ticks: 0 };
      // instant break
      const d = this.destroyProgressPerTick(def, p.inventory.held);
      if (d >= 1) {
        p.swing();
        this.destroyBlock(hit.x, hit.y, hit.z);
        this.breaking = null;
        this.destroyDelay = 5;
        return;
      }
    }
    const br = this.breaking;
    br.progress += this.destroyProgressPerTick(def, p.inventory.held);
    if (br.ticks % 4 === 0) this.game.sound.playBlock('hit', def.sound, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    if (br.ticks % 2 === 0) this.game.fx?.blockHit?.(hit.x, hit.y, hit.z, hit.face, v);
    br.ticks++;
    p.swing();
    if (br.progress >= 1) {
      this.destroyBlock(hit.x, hit.y, hit.z);
      this.breaking = null;
      this.destroyDelay = 5;
    }
  }

  stopDestroy() { this.breaking = null; }

  breakStage() {
    if (!this.breaking) return -1;
    return Math.min(9, Math.floor(this.breaking.progress * 10));
  }

  destroyBlock(x, y, z) {
    const w = this.world, p = this.player;
    const v = w.getBlock(x, y, z);
    const def = BlockById[idOf(v)];
    const held = p.inventory.held;
    const meta = v >>> 12;
    // double blocks
    if (def.shape === 'door') {
      const upper = (meta & 8) !== 0;
      const oy = upper ? y - 1 : y + 1;
      if (idOf(w.getBlock(x, oy, z)) === def.id) w.setBlock(x, oy, z, 0, SB_ALL & ~4);
    }
    if (def.shape === 'bed') {
      const facing = meta & 3, head = (meta & 4) !== 0;
      const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][facing];
      const ox = head ? -d[0] : d[0], oz = head ? -d[1] : d[1];
      if (idOf(w.getBlock(x + ox, y, z + oz)) === def.id) w.setBlock(x + ox, y, z + oz, 0, SB_ALL & ~4);
    }
    // ice melts into water if something is below
    let replacement = def.waterlogged ? packBlock(B.water, 0) : 0;
    if (def.name === 'ice' && !p.creative) {
      const below = BlockById[idOf(w.getBlock(x, y - 1, z))];
      if (below.solid || below.liquid) replacement = packBlock(B.water, 0);
    }
    w.setBlock(x, y, z, replacement);
    this.game.fx?.blockBreak?.(x, y, z, v);
    this.game.sound.playBlock('break', def.sound, x + 0.5, y + 0.5, z + 0.5);
    if (!p.creative) {
      if (!(def.shape === 'door' && (meta & 8))) this.game.dropBlockItems(x, y, z, v, held, p);
      if (def.xp && this.canHarvest(def, held) && !(held?.enchantLevel('silk_touch') > 0)) {
        const [a, b] = def.xp;
        const n = a + Math.floor(Math.random() * (b - a + 1));
        if (n > 0) this.game.spawnXp(x + 0.5, y + 0.5, z + 0.5, n);
      }
      p.exhaust(0.005);
      if (held && held.item?.durability && def.hardness !== 0) {
        const cost = held.item.tool?.type === 'sword' ? 2 : held.item.tool ? 1 : 0;
        if (cost && held.hurt(cost)) this.breakHeldItem();
        p.inventory.changed();
      }
    }
  }

  breakHeldItem() {
    const p = this.player;
    p.inventory.held = null;
    this.game.sound.play('random.break', { x: p.x, y: p.y, z: p.z, volume: 0.8, pitch: 0.8 + Math.random() * 0.4 });
  }

  // ---------- attacking (Java 1.9+) ----------
  attack(target) {
    const p = this.player;
    p.swing();
    if (p.spectator) return;
    if (target.isItem || target.isXpOrb || target.isArrow) return;
    let dmg = p.attackDamage();
    const held = p.inventory.held;
    let bonus = 0;
    if (held) {
      const sharp = held.enchantLevel('sharpness');
      if (sharp > 0) bonus += 0.5 * sharp + 0.5;
      if (target.undead) bonus += 2.5 * held.enchantLevel('smite');
      if (target.arthropod) bonus += 2.5 * held.enchantLevel('bane_of_arthropods');
    }
    const strength = p.attackStrength(0.5);
    dmg *= 0.2 + strength * strength * 0.8;
    bonus *= strength;
    p.resetAttackStrength();
    if (target.isTnt || target.isBoat) return;
    if (dmg <= 0 && bonus <= 0) return;
    const full = strength > 0.9;
    let kb = held?.enchantLevel('knockback') ?? 0;
    let sprintHit = false;
    const snd = (n) => this.game.sound.play(n, { x: p.x, y: p.y, z: p.z, volume: 1 });
    if (p.sprinting && full) { snd('player.attack.knockback'); kb++; sprintHit = true; }
    const crit = full && p.fallDistance > 0 && !p.onGround && !p.onClimbable() && !p.inWater && !p.hasEffect('blindness') && !p.sprinting && target.isLiving;
    if (crit) dmg *= 1.5;
    dmg += bonus;
    const walked = p.walkDist - p.walkDistO;
    let sweep = false;
    if (full && !crit && !sprintHit && p.onGround && walked < p.speed && held?.item?.tool?.type === 'sword') sweep = true;
    const fireAspect = held?.enchantLevel('fire_aspect') ?? 0;
    const hpBefore = target.health;
    if (fireAspect > 0 && target.isLiving) target.setOnFire(1);
    const ok = target.hurt({ type: 'player', entity: p, pos: [p.x, p.y, p.z] }, dmg);
    if (ok) {
      if (kb > 0) {
        target.knockback?.(kb * 0.5, Math.sin(p.yaw), Math.cos(p.yaw));
        p.vx *= 0.6; p.vz *= 0.6;
        p.sprinting = false;
      }
      if (sweep) {
        const tb = target.aabb();
        const sweepDmg = 1 + (held.enchantLevel('sweeping') > 0 ? dmg * (held.enchantLevel('sweeping') / (held.enchantLevel('sweeping') + 1)) : 0);
        for (const e of this.game.entities.list) {
          if (e === p || e === target || !e.isLiving || e.dead) continue;
          const eb = e.aabb();
          if (eb[3] < tb[0] - 1 || eb[0] > tb[3] + 1 || eb[4] < tb[1] - 0.25 || eb[1] > tb[4] + 0.25 || eb[5] < tb[2] - 1 || eb[2] > tb[5] + 1) continue;
          if (p.distanceTo(e) > 3) continue;
          e.knockback(0.4, Math.sin(p.yaw), Math.cos(p.yaw));
          e.hurt({ type: 'player', entity: p, pos: [p.x, p.y, p.z], knockback: false }, sweepDmg);
        }
        snd('player.attack.sweep');
        this.game.fx?.sweep?.(p);
      }
      if (crit) { snd('player.attack.crit'); this.game.fx?.crit?.(target); }
      if (!crit && !sweep) snd(full ? 'player.attack.strong' : 'player.attack.weak');
      if (bonus > 0) this.game.fx?.enchantedHit?.(target);
      // damage indicator particles (dark hearts)
      const dealt = hpBefore - target.health;
      if (dealt > 2) this.game.fx?.damageHearts?.(target, Math.floor(dealt / 2));
      if (held && held.item?.durability) {
        const cost = held.item.tool && held.item.tool.type !== 'sword' ? 2 : 1;
        if (held.hurt(cost)) this.breakHeldItem();
        p.inventory.changed();
      }
      p.exhaust(0.1);
    } else {
      snd('player.attack.nodamage');
    }
  }

  // ---------- using / placing ----------
  useItemOrBlock() {
    const p = this.player;
    for (const hand of ['main', 'off']) {
      const stack = hand === 'main' ? p.inventory.held : p.inventory.offhand;
      // entity interaction
      if (this.targetEntity) {
        if (this.targetEntity.interact?.(p, stack, hand)) { p.swing(); this.useDelay = 4; return; }
      }
      if (this.target) {
        const r = this.useOnBlock(this.target, stack, hand);
        if (r === 'consume') { this.useDelay = 4; return; }
        if (r === 'pass_hand') continue;
      }
      if (stack && this.useItem(stack, hand)) { this.useDelay = 4; return; }
    }
    this.useDelay = 4;
  }

  useOnBlock(hit, stack, hand) {
    const p = this.player, w = this.world;
    const v = w.getBlock(hit.x, hit.y, hit.z);
    const def = BlockById[idOf(v)];
    const bothEmpty = !p.inventory.held && !p.inventory.offhand;
    // block interaction (unless sneaking with an item)
    if (def.interact && (!p.sneaking || bothEmpty) && hand === 'main') {
      if (this.game.interactBlock(hit.x, hit.y, hit.z, v, def, p)) { p.swing(); return 'consume'; }
    }
    if (!stack) return 'pass_hand';
    const it = stack.item;
    // tools used on blocks
    if (it.tool?.type === 'hoe' && (def.id === B.grass_block || def.id === B.dirt || def.id === B.dirt_path || def.id === B.coarse_dirt) && hit.face !== 2) {
      if (w.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
        w.setBlock(hit.x, hit.y, hit.z, def.id === B.coarse_dirt ? B.dirt : B.farmland);
        this.game.sound.play('item.hoe.till', { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 });
        this.damageHeld(hand, 1);
        p.swing();
        return 'consume';
      }
    }
    if (it.tool?.type === 'shovel' && def.id === B.grass_block && hit.face !== 2 && w.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
      w.setBlock(hit.x, hit.y, hit.z, B.dirt_path);
      this.game.sound.play('step.grass', { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 });
      this.damageHeld(hand, 1);
      p.swing();
      return 'consume';
    }
    if (it.name === 'shears' && def.id === B.pumpkin) {
      const facing = this.facingFromLook();
      w.setBlock(hit.x, hit.y, hit.z, packBlock(B.carved_pumpkin, facing));
      this.game.spawnItem(hit.x + 0.5, hit.y + 1, hit.z + 0.5, ItemStack.of('wheat_seeds', 4));
      this.damageHeld(hand, 1);
      p.swing();
      return 'consume';
    }
    if (it.use === 'ignite' || it.use === 'ignite_charge') {
      const charge = it.use === 'ignite_charge';
      if (def.id === B.tnt) {
        w.setBlock(hit.x, hit.y, hit.z, 0);
        this.game.primeTnt(hit.x, hit.y, hit.z, p);
      } else {
        const [ox, oy, oz] = FACE_OFFSETS[hit.face];
        const tx = hit.x + ox, ty = hit.y + oy, tz = hit.z + oz;
        if (w.getBlock(tx, ty, tz) === 0) {
          const portal = tryLightPortal(w, tx, ty, tz);
          if (portal) this.game.registerPortalNear(w.dimension, portal.x0, portal.y0, portal.z0);
          else {
            const under = w.getBlock(tx, ty - 1, tz) & ID_MASK;
            const soul = under === B.soul_sand || under === B.soul_soil;
            w.setBlock(tx, ty, tz, packBlock(soul ? B.soul_fire : B.fire, 0));
            if (!soul) w.scheduleTick(tx, ty, tz, 30);
          }
        } else return 'pass';
      }
      if (charge) this.game.sound.play('item.firecharge.use', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, pitch: (Math.random() - Math.random()) * 0.2 + 1 });
      else this.game.sound.play('fire.ignite', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, pitch: 0.8 + Math.random() * 0.4 });
      if (charge) { if (!p.creative) this.consumeOne(hand); } else this.damageHeld(hand, 1);
      p.swing();
      return 'consume';
    }
    if (it.name === 'bone_meal') {
      if (this.game.boneMeal(hit.x, hit.y, hit.z)) {
        if (!p.creative) this.consumeOne(hand);
        p.swing();
        return 'consume';
      }
    }
    if (it.use === 'bucket') return this.useBucket(stack, hand) ? 'consume' : 'pass';
    // placing blocks
    const placeName = it.places ?? (it.block !== undefined ? BlockById[it.block].name : null);
    if (placeName) {
      if (this.place(hit, stack, hand, Blocks[placeName])) return 'consume';
      return 'pass';
    }
    return 'pass';
  }

  consumeOne(hand) {
    const p = this.player;
    const slot = hand === 'main' ? p.inventory.selected : OFFHAND;
    const s = p.inventory.slots[slot];
    if (!s) return;
    s.count--;
    if (s.count <= 0) p.inventory.slots[slot] = null;
    p.inventory.changed();
  }

  damageHeld(hand, n) {
    const p = this.player;
    if (p.creative) return;
    const slot = hand === 'main' ? p.inventory.selected : OFFHAND;
    const s = p.inventory.slots[slot];
    if (s && s.hurt(n)) {
      p.inventory.slots[slot] = null;
      this.game.sound.play('random.break', { x: p.x, y: p.y, z: p.z });
    }
    p.inventory.changed();
  }

  facingFromLook() {
    // front faces the player: looking north (-Z) -> front faces south (1)
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 2 : 3; // looking east -> faces west
    return fz > 0 ? 0 : 1;
  }
  lookFacing() {
    // direction the player is looking (horizontal) as facing index 0 N,1 S,2 W,3 E
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 2;
    return fz > 0 ? 1 : 0;
  }

  place(hit, stack, hand, def) {
    const p = this.player, w = this.world;
    if (!def) return false;
    if (p.gamemode === 'adventure') return false;
    let x = hit.x, y = hit.y, z = hit.z;
    const tv = w.getBlock(x, y, z);
    const tdef = BlockById[idOf(tv)];
    let meta = 0;
    const face = hit.face;
    const fracY = hit.hitY - Math.floor(hit.hitY);
    // slab merging
    if (def.shape === 'slab' && tdef.id === def.id) {
      const tm = tv >>> 12;
      if ((tm === 0 && face === 3) || (tm === 1 && face === 2)) {
        w.setBlock(x, y, z, packBlock(def.id, 2));
        this.afterPlace(x, y, z, def, hand);
        return true;
      }
    }
    // snow layers stack
    if (def.name === 'snow' && tdef.id === def.id && (tv >>> 12) < 7) {
      w.setBlock(x, y, z, packBlock(def.id, (tv >>> 12) + 1));
      this.afterPlace(x, y, z, def, hand);
      return true;
    }
    if (!(tdef.replaceable && !(tdef.id === def.id && def.name === 'snow')) || tdef.liquid && def.liquid) {
      const [ox, oy, oz] = FACE_OFFSETS[face];
      x += ox; y += oy; z += oz;
    }
    if (y < MIN_Y || y >= MAX_Y) return false;
    const cur = w.getBlock(x, y, z);
    const cdef = BlockById[idOf(cur)];
    if (def.shape === 'slab' && cdef.id === def.id && (cur >>> 12) !== 2) {
      w.setBlock(x, y, z, packBlock(def.id, 2));
      this.afterPlace(x, y, z, def, hand);
      return true;
    }
    if (!cdef.replaceable) return false;
    // orientation
    switch (def.orient) {
      case 'axis': meta = face <= 1 ? 1 : face >= 4 ? 2 : 0; break;
      case 'facing': meta = this.facingFromLook(); break;
      case 'slab': meta = face === 2 ? 1 : face === 3 ? 0 : (fracY > 0.5 ? 1 : 0); break;
      case 'stairs': meta = this.lookFacing() | ((face === 2 || (face !== 3 && fracY > 0.5)) ? 4 : 0); break;
      case 'torch': {
        if (face === 3) meta = 0;
        else if (face === 2) return false;
        else meta = { 0: 4, 1: 3, 4: 2, 5: 1 }[face];
        break;
      }
      case 'ladder': {
        if (face === 2 || face === 3) {
          // choose a wall around
          meta = -1;
          for (const [m, dx, dz] of [[0, 0, -1], [1, 0, 1], [2, -1, 0], [3, 1, 0]]) {
            if (BlockById[idOf(w.getBlock(x + dx, y, z + dz))].opaque) { meta = m; break; }
          }
          if (meta < 0) return false;
        } else meta = { 0: 3, 1: 2, 4: 1, 5: 0 }[face];
        break;
      }
      case 'trapdoor': meta = this.facingFromLook() | ((face === 2 || (face !== 3 && fracY > 0.5)) ? 8 : 0); break;
      case 'lantern': {
        // hang from the ceiling when clicking a block's underside; otherwise stand, falling back to the other mode
        const logic = this.game.blockLogic;
        const first = face === 2 ? 2 : 0;
        meta = first;
        if (logic && !logic.canSurvive(x, y, z, packBlock(def.id, first), def) && logic.canSurvive(x, y, z, packBlock(def.id, first ^ 2), def)) meta = first ^ 2;
        break;
      }
      default: break;
    }
    const value = packBlock(def.id, meta);
    // support
    if (def.support && this.game.blockLogic && !this.game.blockLogic.canSurvive(x, y, z, value, def)) {
      if (!(def.support === 'door')) return false;
    }
    // multi-block placement
    if (def.orient === 'door') {
      if (!BlockById[idOf(w.getBlock(x, y + 1, z))].replaceable) return false;
      if (!this.game.blockLogic.isSturdy(w.getBlock(x, y - 1, z), 'up')) return false;
      const facing = this.lookFacing();
      // hinge: if a door is to the left, hinge right
      const leftDir = [[-1, 0], [1, 0], [0, 1], [0, -1]][facing];
      const leftId = idOf(w.getBlock(x + leftDir[0], y, z + leftDir[1]));
      const hinge = leftId === def.id ? 1 : 0;
      if (this.entityBlocks(x, y, z, def, packBlock(def.id, facing)) || this.entityBlocks(x, y + 1, z, def, packBlock(def.id, 8 | hinge))) return false;
      w.setBlock(x, y, z, packBlock(def.id, facing), SB_ALL & ~4);
      w.setBlock(x, y + 1, z, packBlock(def.id, 8 | hinge), SB_ALL & ~4);
      this.afterPlace(x, y, z, def, hand);
      return true;
    }
    if (def.orient === 'bed') {
      const facing = this.lookFacing();
      const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][facing];
      const hx = x + d[0], hz = z + d[1];
      if (!BlockById[idOf(w.getBlock(hx, y, hz))].replaceable) return false;
      if (!this.game.blockLogic.isSturdy(w.getBlock(x, y - 1, z), 'up') || !this.game.blockLogic.isSturdy(w.getBlock(hx, y - 1, hz), 'up')) return false;
      w.setBlock(x, y, z, packBlock(def.id, facing), SB_ALL & ~4);
      w.setBlock(hx, y, hz, packBlock(def.id, facing | 4), SB_ALL & ~4);
      this.afterPlace(x, y, z, def, hand);
      return true;
    }
    if (this.entityBlocks(x, y, z, def, value)) return false;
    // placing a block into water source keeps it waterlogged if supported
    const placeValue = def.waterlogged && !cdef.liquid ? null : value;
    if (placeValue === null) return false;
    w.setBlock(x, y, z, value);
    if (def.interact === 'chest') this.game.createBlockEntity(x, y, z, 'chest');
    if (def.interact === 'furnace') this.game.createBlockEntity(x, y, z, 'furnace');
    if (def.leaves) w.setBlock(x, y, z, packBlock(def.id, 1), 0); // player-placed leaves are persistent
    this.afterPlace(x, y, z, def, hand);
    return true;
  }

  entityBlocks(x, y, z, def, value) {
    const boxes = getCollisionBoxes(def, value >>> 12, () => 0);
    if (!boxes.length) return false;
    for (const e of this.game.entities.list) {
      if (!e.blocksPlacement || e.removed || e.dead) continue;
      const eb = e.aabb();
      for (const b of boxes) {
        if (eb[0] < x + b[3] && eb[3] > x + b[0] && eb[1] < y + b[4] && eb[4] > y + b[1] && eb[2] < z + b[5] && eb[5] > z + b[2]) return true;
      }
    }
    return false;
  }

  afterPlace(x, y, z, def, hand) {
    const p = this.player;
    this.game.sound.playBlock('place', def.sound, x + 0.5, y + 0.5, z + 0.5);
    p.swing();
    if (!p.creative) this.consumeOne(hand);
    this.game.stats && (this.game.stats.placed = (this.game.stats.placed ?? 0) + 1);
  }

  useBucket(stack, hand) {
    const p = this.player, w = this.world;
    const it = stack.item;
    const [dx, dy, dz] = this.lookVector();
    const hit = raycastBlocks(w, p.x, p.y + p.eyeHeight, p.z, dx, dy, dz, this.reach(), { fluids: it.name === 'bucket' });
    if (!hit) return false;
    if (it.name === 'bucket') {
      const v = w.getBlock(hit.x, hit.y, hit.z);
      const def = BlockById[idOf(v)];
      if (def.liquid && (v >>> 12) === 0) {
        w.setBlock(hit.x, hit.y, hit.z, 0);
        const filled = ItemStack.of(def.liquid === 'water' ? 'water_bucket' : 'lava_bucket');
        this.game.sound.play('item.bucket.fill', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
        this.replaceHeld(hand, filled);
        return true;
      }
      return false;
    }
    if (it.fills) {
      let x = hit.x, y = hit.y, z = hit.z;
      const tv = w.getBlock(x, y, z);
      if (!BlockById[idOf(tv)].replaceable) { const o = FACE_OFFSETS[hit.face]; x += o[0]; y += o[1]; z += o[2]; }
      const cur = BlockById[idOf(w.getBlock(x, y, z))];
      if (!cur.replaceable && !cur.liquid) return false;
      if (it.fills === 'water' && w.ultrawarm) {
        // water evaporates in the Nether
        this.game.sound.play('block.fire.extinguish', { x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.5, pitch: 2.6 + (Math.random() - Math.random()) * 0.8 });
        for (let i = 0; i < 8; i++) this.game.fx.smokeAt(x + Math.random(), y + Math.random(), z + Math.random(), true);
        if (!p.creative) this.replaceHeld(hand, ItemStack.of('bucket'));
        p.swing();
        return true;
      }
      if (cur.render === 'cross' || cur.name === 'snow') this.game.dropBlockItems(x, y, z, w.getBlock(x, y, z), null);
      w.setBlock(x, y, z, packBlock(it.fills === 'water' ? B.water : B.lava, 0));
      this.game.sound.play('item.bucket.empty', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      if (!p.creative) this.replaceHeld(hand, ItemStack.of('bucket'));
      p.swing();
      return true;
    }
    return false;
  }

  replaceHeld(hand, newStack) {
    const p = this.player;
    if (p.creative) { if (p.inventory.findSlot(newStack.id) < 0) p.inventory.add(newStack); return; }
    const slot = hand === 'main' ? p.inventory.selected : OFFHAND;
    const s = p.inventory.slots[slot];
    if (s && s.count > 1) {
      s.count--;
      if (p.inventory.add(newStack) > 0) this.game.dropFromPlayer(newStack);
    } else p.inventory.slots[slot] = newStack;
    p.inventory.changed();
  }

  useItem(stack, hand) {
    const p = this.player;
    const it = stack.item;
    if (it.food) {
      if (p.food.food < 20 || it.food.always || p.creative) { p.startUsing(hand); return true; }
      return false;
    }
    if (it.use === 'bow') {
      if (p.creative || p.inventory.count(Items.arrow.id) > 0 || p.inventory.offhand?.id === Items.arrow.id) { p.startUsing(hand); return true; }
      return false;
    }
    if (it.use === 'shield') { if (p.shieldCooldown === 0) { p.startUsing(hand); return true; } return false; }
    if (it.use === 'drink_milk') { p.startUsing(hand); return true; }
    if (it.use === 'equip' || it.armor || (it.block !== undefined && BlockById[it.block].armorSlot)) {
      const slotName = it.armor?.slot ?? BlockById[it.block]?.armorSlot;
      const idx = ARMOR_SLOT_INDEX[slotName];
      if (idx !== undefined && !p.inventory.slots[idx]) {
        p.inventory.slots[idx] = stack.copy(1);
        if (!p.creative) this.consumeOne(hand);
        p.inventory.changed();
        const mat = it.material ?? 'generic';
        this.game.sound.play(`item.armor.equip_${mat === 'golden' ? 'gold' : ['iron', 'diamond', 'leather'].includes(mat) ? mat : 'generic'}`, { x: p.x, y: p.y, z: p.z });
        p.swing();
        return true;
      }
      return false;
    }
    if (it.use === 'throw_snowball' || it.use === 'throw_egg' || it.name === 'ender_pearl' || it.use === 'throw_xp') {
      this.game.throwProjectile(p, it.name);
      if (!p.creative) this.consumeOne(hand);
      p.swing();
      return true;
    }
    if (it.use === 'bucket') return this.useBucket(stack, hand);
    return false;
  }

  tickUsing() {
    const p = this.player;
    const s = p.useItem;
    if (!s) return;
    const it = s.item;
    if (it.food || it.use === 'drink_milk') {
      if (p.useTicks % 4 === 0 && p.useTicks > 0 && p.useTicks < 30) {
        if (it.food) {
          this.game.sound.play('random.eat', { x: p.x, y: p.y, z: p.z, volume: 0.5 + 0.5 * Math.random(), pitch: (Math.random() - Math.random()) * 0.2 + 1 });
          this.game.fx?.eatParticles?.(p, s);
        } else this.game.sound.play('random.drink', { x: p.x, y: p.y, z: p.z, volume: 0.5 });
      }
      if (p.useTicks >= 32) this.finishUsing();
    }
  }

  finishUsing() {
    const p = this.player;
    const s = p.useItem;
    const it = s.item;
    if (it.food) {
      p.food.eat(it.food.hunger, it.food.saturation);
      for (const e of it.food.effects ?? []) if (Math.random() < e.chance) p.addEffect(e.id, e.duration, e.amp);
      this.game.sound.play('random.burp', { x: p.x, y: p.y, z: p.z, volume: 0.5, pitch: Math.random() * 0.1 + 0.9 });
      if (!p.creative) {
        this.consumeOne(p.useHand);
        if (it.container) this.giveBack(ItemStack.of(it.container));
      }
    } else if (it.use === 'drink_milk') {
      p.effects.clear();
      p.absorption = 0;
      if (!p.creative) { this.consumeOne(p.useHand); this.giveBack(ItemStack.of('bucket')); }
    }
    p.stopUsing();
  }

  giveBack(stack) {
    const p = this.player;
    const slot = p.useHand === 'off' ? OFFHAND : p.inventory.selected;
    if (!p.inventory.slots[slot]) { p.inventory.slots[slot] = stack; p.inventory.changed(); return; }
    if (p.inventory.add(stack) > 0) this.game.dropFromPlayer(stack);
  }

  releaseUsing() {
    const p = this.player;
    const s = p.useItem;
    if (!s) return;
    if (s.item.use === 'bow') {
      let f = p.useTicks / 20;
      f = (f * f + f * 2) / 3;
      if (f > 1) f = 1;
      if (f >= 0.1) this.game.shootArrow(p, f, s);
    }
    p.stopUsing();
  }

  // Q key
  dropHeld(all) {
    const p = this.player;
    const s = p.inventory.held;
    if (!s) return;
    const n = all ? s.count : 1;
    const drop = s.copy(n);
    s.count -= n;
    if (s.count <= 0) p.inventory.held = null;
    p.inventory.changed();
    this.game.dropFromPlayer(drop);
    p.swing();
  }

  swapHands() {
    const p = this.player;
    const inv = p.inventory;
    const a = inv.slots[inv.selected], b = inv.slots[OFFHAND];
    inv.slots[inv.selected] = b; inv.slots[OFFHAND] = a;
    inv.changed();
  }

  pickBlock() {
    const p = this.player;
    const hit = this.target;
    if (!hit) return;
    const v = this.world.getBlock(hit.x, hit.y, hit.z);
    const def = BlockById[idOf(v)];
    let itemId = def.item ? def.id : null;
    if (def.crop) itemId = Items[def.crop.seed]?.id ?? null;
    if (def.name === 'lit_furnace') itemId = Items.furnace.id;
    if (def.berry) itemId = Items.sweet_berries.id;
    if (itemId == null || !ItemById[itemId]) return;
    const inv = p.inventory;
    for (let i = 0; i < 9; i++) if (inv.slots[i]?.id === itemId) { inv.selected = i; return; }
    if (p.creative) {
      let slot = inv.selected;
      if (inv.slots[slot]) { for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; } }
      inv.selected = slot;
      inv.set(slot, new ItemStack(itemId, 1));
      return;
    }
    const idx = inv.findSlot(itemId);
    if (idx >= 9) {
      const tmp = inv.slots[inv.selected];
      inv.slots[inv.selected] = inv.slots[idx];
      inv.slots[idx] = tmp;
      inv.changed();
    }
  }
}
