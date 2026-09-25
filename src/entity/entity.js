// Base entity with Minecraft-style per-tick physics and AABB collision.
import { ID_MASK } from '../constants.js';
import { BlockById } from '../registry/blocks.js';
import { fluidHeight } from '../world/world.js';

let nextEntityId = 1;
const boxes = [];

export class Entity {
  constructor(world, type = 'entity') {
    this.world = world;
    this.type = type;
    this.id = nextEntityId++;
    this.x = 0; this.y = 0; this.z = 0;
    this.px = 0; this.py = 0; this.pz = 0;       // previous tick (for interpolation)
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.pyaw = 0; this.ppitch = 0;
    this.width = 0.6; this.height = 1.8;
    this.stepHeight = 0;
    this.onGround = false;
    this.horizontalCollision = false;
    this.verticalCollision = false;
    this.fallDistance = 0;
    this.inWater = false; this.inLava = false; this.eyeInWater = false; this.eyeInLava = false;
    this.waterHeight = 0;
    this.inCobweb = false;
    this.fireTicks = 0;
    this.removed = false;
    this.age = 0;
    this.noPhysics = false;
    this.noGravity = false;
    this.gravity = 0.08;
    this.drag = 0.98;
    this.eyeHeight = 1.62;
    this.persistent = false;
  }

  setPos(x, y, z) { this.x = x; this.y = y; this.z = z; this.px = x; this.py = y; this.pz = z; }

  get minX() { return this.x - this.width / 2; }
  get maxX() { return this.x + this.width / 2; }
  get minZ() { return this.z - this.width / 2; }
  get maxZ() { return this.z + this.width / 2; }

  aabb(inflate = 0) {
    const hw = this.width / 2 + inflate;
    return [this.x - hw, this.y - inflate, this.z - hw, this.x + hw, this.y + this.height + inflate, this.z + hw];
  }

  eyeY() { return this.y + this.eyeHeight; }

  distanceTo(e) { return Math.hypot(this.x - e.x, this.y - e.y, this.z - e.z); }
  distanceSq(x, y, z) { const dx = this.x - x, dy = this.y - y, dz = this.z - z; return dx * dx + dy * dy + dz * dz; }

  // interpolated render position
  lerpPos(t) {
    return [this.px + (this.x - this.px) * t, this.py + (this.y - this.py) * t, this.pz + (this.z - this.pz) * t];
  }

  baseTick() {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.pyaw = this.yaw; this.ppitch = this.pitch;
    this.age++;
    this.updateFluidState();
    if (this.fireTicks > 0) {
      if (this.inWater || this.world.raining && this.world.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z))) this.fireTicks = 0;
      else this.fireTicks--;
    }
    if (this.y < -128) this.onVoid();
  }

  onVoid() { this.remove(); }

  tick() { this.baseTick(); }

  remove() { this.removed = true; }

  updateFluidState() {
    const [x0, y0, z0, x1, y1, z1] = this.aabb(-0.001);
    const w = this.world;
    this.inWater = false; this.inLava = false; this.inCobweb = false;
    let wh = 0;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
          const v = w.getBlock(x, y, z);
          if (v === 0) continue;
          const def = BlockById[v & ID_MASK];
          if (def.liquid || def.waterlogged) {
            const top = y + fluidHeight(v);
            if (top > y0) {
              if (def.liquid === 'lava') this.inLava = true; else this.inWater = true;
              if (def.liquid !== 'lava') wh = Math.max(wh, top - y0);
            }
          } else if (def.cobweb) this.inCobweb = true;
        }
    this.waterHeight = wh;
    const ey = this.y + this.eyeHeight - 0.11111;
    const ev = w.getBlock(Math.floor(this.x), Math.floor(ey), Math.floor(this.z));
    const edef = BlockById[ev & ID_MASK];
    const eTop = Math.floor(ey) + fluidHeight(ev);
    this.eyeInWater = (edef.liquid === 'water' || edef.waterlogged) && ey < eTop;
    this.eyeInLava = edef.liquid === 'lava' && ey < eTop;
    if (this.inWater) { this.fallDistance = 0; if (this.fireTicks > 0) this.fireTicks = 0; }
  }

  // Minecraft Entity.move: collide against blocks, with optional step-up.
  move(dx, dy, dz) {
    if (this.noPhysics) { this.x += dx; this.y += dy; this.z += dz; return; }
    if (this.inCobweb) {
      dx *= 0.25; dy *= 0.05; dz *= 0.25;
      this.vx = 0; this.vy = 0; this.vz = 0;
    }
    // sneaking edge protection
    if (this.preventEdgeFall && this.onGround && dy <= 0) {
      const step = 0.05;
      while (dx !== 0 && this.noCollisionBelow(dx, 0)) { if (Math.abs(dx) < step) dx = 0; else dx -= Math.sign(dx) * step; }
      while (dz !== 0 && this.noCollisionBelow(0, dz)) { if (Math.abs(dz) < step) dz = 0; else dz -= Math.sign(dz) * step; }
      while (dx !== 0 && dz !== 0 && this.noCollisionBelow(dx, dz)) {
        if (Math.abs(dx) < step) dx = 0; else dx -= Math.sign(dx) * step;
        if (Math.abs(dz) < step) dz = 0; else dz -= Math.sign(dz) * step;
      }
    }
    const odx = dx, ody = dy, odz = dz;
    let box = this.aabb();
    const res = collideBox(this.world, box, dx, dy, dz);
    dx = res[0]; dy = res[1]; dz = res[2];
    // step up
    if (this.stepHeight > 0 && (this.onGround || (ody !== dy && ody < 0)) && (dx !== odx || dz !== odz)) {
      const s = collideBox(this.world, box, odx, this.stepHeight, odz);
      const up = collideBox(this.world, box, 0, this.stepHeight, 0);
      let best = s;
      if (up[1] < this.stepHeight) {
        const box2 = [box[0], box[1] + up[1], box[2], box[3], box[4] + up[1], box[5]];
        const hz = collideBox(this.world, box2, odx, 0, odz);
        const cand = [hz[0], up[1], hz[2]];
        if (cand[0] * cand[0] + cand[2] * cand[2] > best[0] * best[0] + best[2] * best[2]) best = cand;
      }
      if (best[0] * best[0] + best[2] * best[2] > dx * dx + dz * dz) {
        // settle back down
        const box3 = [box[0] + best[0], box[1] + best[1], box[2] + best[2], box[3] + best[0], box[4] + best[1], box[5] + best[2]];
        const down = collideBox(this.world, box3, 0, -best[1] + ody, 0);
        dx = best[0]; dy = best[1] + down[1]; dz = best[2];
      }
    }
    this.x += dx; this.y += dy; this.z += dz;
    this.horizontalCollision = Math.abs(odx - dx) > 1e-7 || Math.abs(odz - dz) > 1e-7;
    this.verticalCollision = ody !== dy;
    const wasOnGround = this.onGround;
    this.onGround = this.verticalCollision && ody < 0;
    if (Math.abs(odx - dx) > 1e-7) this.vx = 0;
    if (Math.abs(odz - dz) > 1e-7) this.vz = 0;
    if (ody !== dy) this.vy = 0;
    this.checkFall(dy, this.onGround, wasOnGround);
  }

  noCollisionBelow(dx, dz) {
    const b = this.aabb();
    const test = [b[0] + dx, b[1] - 0.6, b[2] + dz, b[3] + dx, b[1] - 0.001, b[5] + dz];
    this.world.getCollisions(test[0], test[1], test[2], test[3], test[4], test[5], boxes);
    for (const c of boxes) if (overlap(test, c)) return false;
    return true;
  }

  checkFall(dy, onGround) {
    if (onGround) {
      if (this.fallDistance > 0) this.onLand(this.fallDistance);
      this.fallDistance = 0;
    } else if (dy < 0) this.fallDistance -= dy;
  }

  onLand(distance) { void distance; }

  // block under feet (for friction / step sounds)
  blockBelow() {
    const x = Math.floor(this.x), y = Math.floor(this.y - 0.2), z = Math.floor(this.z);
    let v = this.world.getBlock(x, y, z);
    if (v === 0) {
      // standing on the edge of a block: check corners
      const hw = this.width / 2;
      for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
        v = this.world.getBlock(Math.floor(this.x + ox), y, Math.floor(this.z + oz));
        if (v) break;
      }
    }
    return v;
  }

  isInsideOpaque() {
    const w = this.world;
    const ey = this.y + this.eyeHeight;
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(this.x + (((i >> 0) % 2) - 0.5) * this.width * 0.8);
      const y = Math.floor(ey + (((i >> 1) % 2) - 0.5) * 0.1);
      const z = Math.floor(this.z + (((i >> 2) % 2) - 0.5) * this.width * 0.8);
      const def = BlockById[w.getBlock(x, y, z) & ID_MASK];
      if (def.opaque && def.solid) return true;
    }
    return false;
  }

  serialize() { return { type: this.type, x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, yaw: this.yaw, pitch: this.pitch, fire: this.fireTicks, age: this.age }; }
  deserialize(d) { this.setPos(d.x, d.y, d.z); this.vx = d.vx; this.vy = d.vy; this.vz = d.vz; this.yaw = d.yaw; this.pitch = d.pitch; this.fireTicks = d.fire ?? 0; this.age = d.age ?? 0; }
}

function overlap(a, b) {
  return a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];
}

// Returns clipped [dx, dy, dz] for moving box by (dx,dy,dz); order Y, X, Z like Minecraft (X/Z by magnitude).
export function collideBox(world, box, dx, dy, dz) {
  const minX = Math.min(box[0], box[0] + dx), maxX = Math.max(box[3], box[3] + dx);
  const minY = Math.min(box[1], box[1] + dy), maxY = Math.max(box[4], box[4] + dy);
  const minZ = Math.min(box[2], box[2] + dz), maxZ = Math.max(box[5], box[5] + dz);
  const list = world.getCollisions(minX, minY, minZ, maxX, maxY, maxZ, boxes);
  let b0 = box[0], b1 = box[1], b2 = box[2], b3 = box[3], b4 = box[4], b5 = box[5];
  // Y
  if (dy !== 0) {
    for (const c of list) {
      if (b3 <= c[0] || b0 >= c[3] || b5 <= c[2] || b2 >= c[5]) continue;
      if (dy > 0 && b4 <= c[1] + 1e-7) { const d = c[1] - b4; if (d < dy) dy = d; }
      else if (dy < 0 && b1 >= c[4] - 1e-7) { const d = c[4] - b1; if (d > dy) dy = d; }
    }
    b1 += dy; b4 += dy;
  }
  const xFirst = Math.abs(dx) >= Math.abs(dz);
  for (let pass = 0; pass < 2; pass++) {
    const doX = xFirst ? pass === 0 : pass === 1;
    if (doX && dx !== 0) {
      for (const c of list) {
        if (b4 <= c[1] || b1 >= c[4] || b5 <= c[2] || b2 >= c[5]) continue;
        if (dx > 0 && b3 <= c[0] + 1e-7) { const d = c[0] - b3; if (d < dx) dx = d; }
        else if (dx < 0 && b0 >= c[3] - 1e-7) { const d = c[3] - b0; if (d > dx) dx = d; }
      }
      b0 += dx; b3 += dx;
    } else if (!doX && dz !== 0) {
      for (const c of list) {
        if (b4 <= c[1] || b1 >= c[4] || b3 <= c[0] || b0 >= c[3]) continue;
        if (dz > 0 && b5 <= c[2] + 1e-7) { const d = c[2] - b5; if (d < dz) dz = d; }
        else if (dz < 0 && b2 >= c[5] - 1e-7) { const d = c[5] - b2; if (d > dz) dz = d; }
      }
      b2 += dz; b5 += dz;
    }
  }
  return [dx, dy, dz];
}

export function aabbOverlap(a, b) { return overlap(a, b); }
