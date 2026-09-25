// Particle effects (terrain debris, crits, sweep attacks, explosions, smoke, hearts...)
import { ID_MASK } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';
import { ItemById, Items } from '../registry/items.js';

const MAX = 4000;

class Particle {
  constructor(kind, x, y, z, vx, vy, vz) {
    this.kind = kind; // 'block' | 'sprite' | 'item'
    this.x = x; this.y = y; this.z = z; this.px = x; this.py = y; this.pz = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.age = 0; this.life = 20;
    this.size = 0.1; this.gravity = 0; this.friction = 0.98;
    this.r = 1; this.g = 1; this.b = 1; this.a = 1;
    this.collide = true; this.onGround = false;
    this.sprite = null; this.frames = null; // sprite names for animation
    this.layer = 0; this.uv = null;
    this.emissive = false;
    this.grow = 0;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    this.list = [];
  }
  get world() { return this.game.world; }

  add(p) { if (this.list.length < MAX) this.list.push(p); return p; }

  tick() {
    const w = this.world;
    for (const p of this.list) {
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (++p.age >= p.life) { p.dead = true; continue; }
      p.vy -= p.gravity;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.collide) {
        const v = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        const def = BlockById[v & ID_MASK];
        if (def.solid && def.render !== 'cross') {
          // stop against blocks (cheap collision)
          if (!BlockById[w.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z)) & ID_MASK].solid) { nx = p.x; nz = p.z; p.vx *= -0.2; p.vz *= -0.2; }
          else { ny = Math.floor(p.y) + (p.vy < 0 ? 0.01 : 0); if (p.vy < 0) { p.onGround = true; } p.vy = 0; nx = p.x + p.vx; nz = p.z + p.vz; }
        }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= p.friction; p.vy *= p.friction; p.vz *= p.friction;
      if (p.onGround) { p.vx *= 0.7; p.vz *= 0.7; }
      if (p.update) p.update(p);
    }
    this.list = this.list.filter((p) => !p.dead);
  }

  // ---------- emitters ----------
  blockParticle(x, y, z, vx, vy, vz, v) {
    const def = BlockById[v & ID_MASK];
    if (!def || def.render === 'air') return;
    const T = this.game.renderer.textures;
    const tex = def.particle ?? def.faces[4];
    const e = T.get(tex);
    const p = new Particle('block', x, y, z, vx, vy, vz);
    p.layer = e.layer;
    const u = Math.floor(Math.random() * 12), vv = Math.floor(Math.random() * 12);
    p.uv = [u / 16, vv / 16, (u + 4) / 16, (vv + 4) / 16];
    p.gravity = 0.04; p.life = Math.floor(4 / (Math.random() * 0.9 + 0.1));
    p.size = 0.1 * (Math.random() * 0.5 + 0.5);
    p.r = p.g = p.b = 0.6;
    if (def.tint) {
      const biome = this.world.getBiomeDef(Math.floor(x), Math.floor(z));
      const col = def.tint === 'grass' ? biome.grass : def.tint === 'water' ? biome.water : def.tint === 'birch' ? 0x80a755 : def.tint === 'spruce' ? 0x619961 : biome.foliage;
      if (def.id !== B.grass_block || tex !== 'dirt') { p.r *= ((col >> 16) & 255) / 255; p.g *= ((col >> 8) & 255) / 255; p.b *= (col & 255) / 255; }
    }
    this.add(p);
  }

  blockBreak(x, y, z, v) {
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
      this.blockParticle(px, py, pz, (px - x - 0.5) * 0.1 * (Math.random() * 2), (py - y - 0.5) * 0.1 * Math.random() * 2 + 0.05, (pz - z - 0.5) * 0.1 * (Math.random() * 2), v);
    }
  }

  blockHit(x, y, z, face, v) {
    const e = 0.1;
    let px = x + Math.random() * (1 - e * 2) + e, py = y + Math.random() * (1 - e * 2) + e, pz = z + Math.random() * (1 - e * 2) + e;
    if (face === 0) px = x - e; if (face === 1) px = x + 1 + e;
    if (face === 2) py = y - e; if (face === 3) py = y + 1 + e;
    if (face === 4) pz = z - e; if (face === 5) pz = z + 1 + e;
    this.blockParticle(px, py, pz, (Math.random() - 0.5) * 0.04, Math.random() * 0.04, (Math.random() - 0.5) * 0.04, v);
  }

  footstep(entity) {
    const v = entity.blockBelow();
    const def = BlockById[v & ID_MASK];
    const g = this.game;
    if (entity.inWater) return;
    if (def.sound && def.sound !== 'none') {
      const above = BlockById[this.world.getBlock(Math.floor(entity.x), Math.floor(entity.y), Math.floor(entity.z)) & ID_MASK];
      const group = above.name === 'snow' ? 'snow' : def.sound;
      g.sound.playBlock('step', group, entity.x, entity.y, entity.z);
    }
    if (entity.sprinting && entity.onGround) {
      for (let i = 0; i < 2; i++) this.blockParticle(entity.x + (Math.random() - 0.5) * entity.width, entity.y + 0.1, entity.z + (Math.random() - 0.5) * entity.width, -entity.vx * 4, 0.15, -entity.vz * 4, v);
    }
  }

  landingParticles(entity, dmg) {
    const v = entity.blockBelow();
    const n = Math.min(40, 5 + dmg * 5);
    for (let i = 0; i < n; i++) this.blockParticle(entity.x + (Math.random() - 0.5) * 0.8, entity.y + 0.05, entity.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3, v);
    const def = BlockById[v & ID_MASK];
    this.game.sound.play(dmg > 4 ? 'damage.fallbig' : 'damage.fallsmall', { x: entity.x, y: entity.y, z: entity.z });
    void def;
  }

  sprite(name, x, y, z, vx, vy, vz, opts = {}) {
    const p = new Particle('sprite', x, y, z, vx, vy, vz);
    p.sprite = name;
    Object.assign(p, opts);
    return this.add(p);
  }

  smoke(x, y, z) {
    for (let i = 0; i < 8; i++) this.smokeAt(x + Math.random(), y + 1.2, z + Math.random(), true);
  }
  smokeAt(x, y, z, large = false) {
    const p = this.sprite('generic_0', x, y, z, (Math.random() - 0.5) * 0.02, 0.02 + Math.random() * 0.02, (Math.random() - 0.5) * 0.02, {
      life: Math.floor(8 / (Math.random() * 0.8 + 0.2)), size: large ? 0.25 : 0.12, collide: false, friction: 0.96,
    });
    const c = Math.random() * 0.3;
    p.r = p.g = p.b = c;
    p.frames = ['generic_7', 'generic_6', 'generic_5', 'generic_4', 'generic_3', 'generic_2', 'generic_1', 'generic_0'];
  }

  explosion(x, y, z, power, count) {
    for (let i = 0; i < 16; i++) {
      const p = this.sprite('explosion_0', x + (Math.random() - Math.random()) * 4, y + (Math.random() - Math.random()) * 4, z + (Math.random() - Math.random()) * 4, 0, 0, 0, {
        life: 6 + Math.floor(Math.random() * 4), size: 2 * (1 - Math.random() * 0.5), collide: false, emissive: true,
      });
      const c = Math.random() * 0.6 + 0.4;
      p.r = p.g = p.b = c;
      p.frames = Array.from({ length: 16 }, (_, k) => `explosion_${k}`);
    }
    for (let i = 0; i < Math.min(100, 20 + count); i++) {
      const p = this.sprite('generic_0', x + (Math.random() - 0.5) * power * 2, y + (Math.random() - 0.5) * power * 2, z + (Math.random() - 0.5) * power * 2,
        (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, { life: 20 + Math.floor(Math.random() * 20), size: 0.3, collide: false, friction: 0.9 });
      p.r = p.g = p.b = 0.8 + Math.random() * 0.2;
      p.frames = ['generic_7', 'generic_6', 'generic_5', 'generic_4', 'generic_3', 'generic_2', 'generic_1', 'generic_0'];
    }
  }

  crit(target) {
    for (let i = 0; i < 16; i++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      if (dx * dx + dy * dy + dz * dz > 1) continue;
      const p = this.sprite('crit', target.x + dx * target.width / 4, target.y + target.height / 2 + dy * target.height / 4, target.z + dz * target.width / 4, dx * 0.5, dy * 0.5 + 0.2, dz * 0.5, {
        life: 6 + Math.floor(Math.random() * 6), size: 0.1, gravity: 0.04 * 0.5, friction: 0.7,
      });
      p.r = 0.8 + Math.random() * 0.2; p.g = 0.7 + Math.random() * 0.2; p.b = 0.4;
    }
  }
  enchantedHit(target) {
    for (let i = 0; i < 16; i++) {
      const dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const p = this.sprite('enchanted_hit', target.x + dx * target.width / 4, target.y + target.height / 2 + dy * target.height / 4, target.z + dz * target.width / 4, dx * 0.5, dy * 0.5 + 0.2, dz * 0.5, {
        life: 8 + Math.floor(Math.random() * 4), size: 0.1, gravity: 0.02, friction: 0.7,
      });
      p.r = 0.4; p.g = 0.6; p.b = 1;
    }
  }
  critTrail(arrow) {
    const p = this.sprite('crit', arrow.x, arrow.y + 0.25, arrow.z, -arrow.vx * 0.2, -arrow.vy * 0.2 + 0.1, -arrow.vz * 0.2, { life: 6, size: 0.08, friction: 0.7, gravity: 0.02 });
    p.r = 0.9; p.g = 0.8; p.b = 0.5;
  }
  sweep(player) {
    const yaw = player.yaw;
    const x = player.x - Math.sin(yaw), z = player.z - Math.cos(yaw);
    const p = this.sprite('sweep_0', x, player.y + player.height * 0.5, z, 0, 0, 0, { life: 4, size: 1.0 - 0.0, collide: false, emissive: true });
    p.frames = Array.from({ length: 8 }, (_, k) => `sweep_${k}`);
    const c = Math.random() * 0.6 + 0.4;
    p.r = p.g = p.b = c;
  }
  damageHearts(target, n) {
    for (let i = 0; i < Math.min(n, 10); i++) {
      this.sprite('damage', target.x + (Math.random() - 0.5) * target.width, target.y + target.height * 0.5, target.z + (Math.random() - 0.5) * target.width,
        (Math.random() - 0.5) * 0.2, 0.2 + Math.random() * 0.1, (Math.random() - 0.5) * 0.2, { life: 20, size: 0.1, gravity: 0.03, friction: 0.86 });
    }
  }
  hearts(mob) {
    this.sprite('heart', mob.x + (Math.random() - 0.5) * mob.width, mob.y + mob.height * 0.7 + Math.random() * 0.4, mob.z + (Math.random() - 0.5) * mob.width,
      (Math.random() - 0.5) * 0.04, 0.02, (Math.random() - 0.5) * 0.04, { life: 16, size: 0.15, collide: false, friction: 0.86 });
  }
  poof(mob) {
    for (let i = 0; i < 20; i++) {
      const p = this.sprite('generic_0', mob.x + (Math.random() * 2 - 1) * mob.width, mob.y + Math.random() * mob.height, mob.z + (Math.random() * 2 - 1) * mob.width,
        (Math.random() - 0.5) * 0.04, Math.random() * 0.04, (Math.random() - 0.5) * 0.04, { life: 8 + Math.floor(Math.random() * 12), size: 0.15, collide: false, friction: 0.96 });
      p.r = p.g = p.b = 1;
      p.frames = ['generic_7', 'generic_6', 'generic_5', 'generic_4', 'generic_3', 'generic_2', 'generic_1', 'generic_0'];
    }
  }
  portal(x, y, z) {
    for (let i = 0; i < 32; i++) {
      const p = this.sprite('generic_0', x + (Math.random() - 0.5), y + Math.random() * 2, z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, { life: 20, size: 0.08, collide: false, emissive: true });
      p.r = 0.7; p.g = 0.3; p.b = 0.9;
    }
  }
  // rune specks drifting from bookshelves into an enchanting table
  enchantGlyph(x, y, z, tx, ty, tz) {
    const life = Math.floor(Math.random() * 10) + 30;
    const p = this.sprite('generic_0', x, y, z, 0, 0, 0, { life, size: 0.05 + Math.random() * 0.03, collide: false, emissive: true });
    const k = Math.random() * 0.6 + 0.4;
    p.r = 0.9 * k; p.g = 0.9 * k; p.b = k;
    const sx = x, sy = y, sz = z;
    // EnchantmentTableParticle: glide from the shelf to the table, dipping at the end
    p.update = (q) => {
      const f = 1 - q.age / life;
      let f1 = 1 - f; f1 *= f1; f1 *= f1;
      q.x = tx + (sx - tx) * f; q.y = ty + (sy - ty) * f - f1 * 1.2; q.z = tz + (sz - tz) * f;
      q.vx = q.vy = q.vz = 0;
    };
  }
  bubble(x, y, z) {
    this.sprite('bubble', x, y, z, (Math.random() - 0.5) * 0.02, 0.02, (Math.random() - 0.5) * 0.02, { life: 20, size: 0.06, collide: false, update: (p) => { p.vy += 0.002; if (!BlockById[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) & ID_MASK].liquid) p.dead = true; } });
  }
  splash(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const p = this.sprite('splash_0', x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.2, 0.1 + Math.random() * 0.2, (Math.random() - 0.5) * 0.2, { life: 8 + Math.floor(Math.random() * 6), size: 0.08, gravity: 0.04 });
      p.r = 0.6; p.g = 0.75; p.b = 1;
      p.frames = ['splash_0', 'splash_1', 'splash_2', 'splash_3'];
    }
  }
  flame(x, y, z) {
    this.sprite('flame', x, y, z, 0, 0.005, 0, { life: 8 + Math.floor(Math.random() * 8), size: 0.06, collide: false, emissive: true, friction: 0.96 });
  }
  lavaPop(x, y, z) {
    this.sprite('lava', x, y, z, (Math.random() - 0.5) * 0.1, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.1, { life: 16 / (Math.random() * 0.8 + 0.2), size: 0.1, gravity: 0.075, emissive: true, friction: 0.999 });
  }
  drip(x, y, z, water) {
    const p = this.sprite('drip_hang', x, y, z, 0, 0, 0, { life: 60, size: 0.05, gravity: 0.02, collide: true });
    if (water) { p.r = 0.2; p.g = 0.3; p.b = 1; } else { p.r = 1; p.g = 0.3; p.b = 0.05; p.emissive = true; }
  }
  eatParticles(player, stack) {
    const it = stack.item;
    for (let i = 0; i < 5; i++) {
      const yaw = player.yaw, pitch = player.pitch;
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      const x = player.x + fx * 0.6 + (Math.random() - 0.5) * 0.3, y = player.y + player.eyeHeight - 0.2 + fy * 0.6, z = player.z + fz * 0.6 + (Math.random() - 0.5) * 0.3;
      this.itemParticle(it, x, y, z, (Math.random() - 0.5) * 0.1, Math.random() * 0.1 + 0.05, (Math.random() - 0.5) * 0.1);
    }
  }
  itemBreak(x, y, z, name) {
    const it = Items[name];
    if (!it) return;
    for (let i = 0; i < 8; i++) this.itemParticle(it, x, y, z, (Math.random() - 0.5) * 0.15, Math.random() * 0.15, (Math.random() - 0.5) * 0.15);
  }
  itemParticle(it, x, y, z, vx, vy, vz) {
    if (it.icon.kind === 'block') { this.blockParticle(x, y, z, vx, vy, vz, it.block); return; }
    const p = new Particle('item', x, y, z, vx, vy, vz);
    p.itemTex = it.icon.tex; p.atlas = it.icon.atlas;
    const u = Math.floor(Math.random() * 12), v = Math.floor(Math.random() * 12);
    p.uv = [u / 16, v / 16, (u + 4) / 16, (v + 4) / 16];
    p.gravity = 0.04; p.life = 10 + Math.floor(Math.random() * 10); p.size = 0.06;
    this.add(p);
  }
  fireOnEntity(e) {
    if (Math.random() < 0.3) this.flame(e.x + (Math.random() - 0.5) * e.width, e.y + Math.random() * e.height, e.z + (Math.random() - 0.5) * e.width);
  }

  // Ambient particles from nearby blocks (torches, lava, water drips) — called each tick
  animateTick(px, py, pz) {
    const w = this.world;
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(px + (Math.random() - Math.random()) * 16), y = Math.floor(py + (Math.random() - Math.random()) * 16), z = Math.floor(pz + (Math.random() - Math.random()) * 16);
      const v = w.getBlock(x, y, z);
      if (v === 0) continue;
      const id = v & ID_MASK;
      if (id === B.torch) {
        const m = v >>> 12;
        let ox = 0.5, oy = 0.7, oz = 0.5; // wall torches lean away from the wall they hang on
        if (m > 0) { const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][m - 1]; ox = 0.5 + d[0] * 0.2; oz = 0.5 + d[1] * 0.2; oy = 0.92; }
        this.smokeAt(x + ox, y + oy, z + oz);
        this.flame(x + ox, y + oy, z + oz);
      } else if (id === B.lava) {
        if (Math.random() < 0.02 && w.getBlock(x, y + 1, z) === 0) {
          this.lavaPop(x + Math.random(), y + 1, z + Math.random());
          if (Math.random() < 0.3) this.game.sound.play('liquid.lavapop', { x: x + 0.5, y: y + 1, z: z + 0.5, volume: 0.2 + Math.random() * 0.2, pitch: 0.9 + Math.random() * 0.15 });
        }
      } else if (id === B.lit_furnace && Math.random() < 0.3) {
        const m = v >>> 12, d = [[0, -1], [0, 1], [-1, 0], [1, 0]][m & 3];
        this.smokeAt(x + 0.5 + d[0] * 0.52, y + 0.3, z + 0.5 + d[1] * 0.52);
        this.flame(x + 0.5 + d[0] * 0.52, y + 0.3, z + 0.5 + d[1] * 0.52);
      } else if (id === B.fire && Math.random() < 0.3) {
        this.smokeAt(x + Math.random(), y + 0.5 + Math.random() * 0.5, z + Math.random(), true);
      }
      // drips from ceilings above water/lava
      if (BlockById[id].opaque && Math.random() < 0.02 && w.getBlock(x, y - 1, z) === 0) {
        const above = BlockById[w.getBlock(x, y + 1, z) & ID_MASK];
        if (above.liquid) this.drip(x + Math.random(), y - 0.05, z + Math.random(), above.liquid === 'water');
      }
    }
  }

  // ---------- render ----------
  render(obj, ctx) {
    const t = ctx.opts.partial;
    const cam = ctx.cam, cp = ctx.camPos, w = this.world;
    for (const p of this.list) {
      const x = p.px + (p.x - p.px) * t - cp[0], y = p.py + (p.y - p.py) * t - cp[1], z = p.pz + (p.z - p.pz) * t - cp[2];
      if (x * x + y * y + z * z > 64 * 64) continue;
      let light;
      if (p.emissive) light = [1, 1];
      else { const l = w.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); light = [(l >> 4) / 15, (l & 15) / 15]; }
      if (p.kind === 'block') {
        const e = { layer: p.layer, w: 16, h: 16 };
        this.quad(obj.blockBatch, x, y, z, p.size, e, cam, [p.r, p.g, p.b, 1], light, p.uv);
      } else if (p.kind === 'item') {
        let layer = 0;
        if (p.atlas === 'block') layer = obj.r.textures.get(p.itemTex).layer;
        else layer = obj.items.layers.get(p.itemTex)?.layer ?? 0;
        this.quad(p.atlas === 'block' ? obj.blockBatch : obj.itemBatch, x, y, z, p.size, { layer, w: 16, h: 16 }, cam, [1, 1, 1, 1], light, p.uv);
      } else {
        let name = p.sprite;
        if (p.frames) name = p.frames[Math.min(p.frames.length - 1, Math.floor((p.age + t) / p.life * p.frames.length))];
        const entry = obj.particles.layers.get(name);
        if (!entry) continue;
        const size = p.size * (p.grow ? 1 + p.age / p.life * p.grow : 1);
        obj.billboard(obj.particleBatch, x, y, z, size, entry, cam, [p.r, p.g, p.b, p.a], light);
      }
    }
  }

  quad(batch, x, y, z, size, e, cam, color, light, uv) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const rx = cy, rz = -sy;
    const ux = -sy * -sp, uy = cp, uz = -cy * -sp;
    const [u0, v0, u1, v1] = uv;
    const pts = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
    const uvs = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [a, b] = pts[k];
      batch.push(x + rx * a * size + ux * b * size, y + uy * b * size, z + rz * a * size + uz * b * size, uvs[k][0], uvs[k][1], e.layer, color[0], color[1], color[2], color[3], light[0], light[1], 0, 0);
    }
  }
}

export { ItemById };
