// Renders entities, dropped items, particles and the first-person hand with a single texture-array shader.
import { Program } from './gl.js';
import { mat4 } from '../util/math.js';
import { MODELS, animate, buildModel } from './models.js';
import { ID_MASK, MIN_Y } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';
import { ItemById, Items } from '../registry/items.js';
import { getRenderBoxes } from '../registry/shapes.js';
import { FACE_VERTS, FACE_UV, uvFromPos } from './mesher.js';
import { XpOrb } from '../entity/objects.js';

const VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_uvl;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_light;
uniform mat4 u_viewProj;
out vec3 v_uvl; out vec4 v_color; out vec4 v_light; out float v_dist;
void main(){
  v_uvl = a_uvl; v_color = a_color; v_light = a_light; v_dist = length(a_pos);
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
in vec3 v_uvl; in vec4 v_color; in vec4 v_light; in float v_dist;
uniform sampler2DArray u_tex; uniform sampler2D u_lightmap;
uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaCut; uniform float u_fullbright;
out vec4 o;
void main(){
  vec4 c = texture(u_tex, v_uvl) * v_color;
  if (c.a < u_alphaCut) discard;
  vec3 lm = u_fullbright > 0.5 ? vec3(1.0) : texture(u_lightmap, vec2(v_light.y, v_light.x) * (15.0/16.0) + 0.5/16.0).rgb;
  c.rgb *= lm;
  c.rgb = mix(c.rgb, vec3(0.7, 0.0, 0.0), v_light.w * 0.45);
  c.rgb = mix(c.rgb, vec3(1.0), v_light.z);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  c.rgb = mix(c.rgb, u_fogColor, f);
  o = c;
}`;

const FLOATS = 14; // pos3 uvl3 color4 light4
const L0 = norm([0.2, 1.0, -0.7]), L1 = norm([-0.2, 1.0, 0.7]);
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
export function entityShade(nx, ny, nz) {
  const a = Math.max(0, nx * L0[0] + ny * L0[1] + nz * L0[2]);
  const b = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]);
  return Math.min(1, 0.4 + 0.6 * (a + b));
}

class Batch {
  constructor() { this.data = new Float32Array(1 << 16); this.n = 0; }
  reset() { this.n = 0; }
  push(x, y, z, u, v, l, r, g, b, a, sky, blk, white, red) {
    if ((this.n + 1) * FLOATS > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const o = this.n * FLOATS, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u; d[o + 4] = v; d[o + 5] = l;
    d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a;
    d[o + 10] = sky; d[o + 11] = blk; d[o + 12] = white; d[o + 13] = red;
    this.n++;
  }
}

// 4x4 matrix stack in the style of vanilla's PoseStack (degrees)
class Pose {
  constructor() { this.m = mat4.create(); this.stack = []; }
  push() { this.stack.push(new Float32Array(this.m)); }
  pop() { this.m = this.stack.pop(); }
  t(x, y, z) { mat4.translate(this.m, this.m, x, y, z); }
  rx(d) { mat4.rotateX(this.m, this.m, d * Math.PI / 180); }
  ry(d) { mat4.rotateY(this.m, this.m, d * Math.PI / 180); }
  rz(d) { mat4.rotateZ(this.m, this.m, d * Math.PI / 180); }
  s(x, y = x, z = x) { mat4.scale(this.m, this.m, x, y, z); }
  apply(x, y, z) { const m = this.m; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; }
  applyN(x, y, z) { const m = this.m; const n = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; return norm(n); }
}

export class ObjectRenderer {
  constructor(renderer, { itemTextures, entityTextures, particleTextures, weatherTextures }) {
    this.r = renderer;
    const gl = this.gl = renderer.gl;
    this.prog = new Program(gl, VS, FS, 'objects');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const st = FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 40);
    gl.bindVertexArray(null);
    // texture arrays
    this.items = this.makeArray(itemTextures, 16, 16);
    this.entities = this.makeArray(entityTextures, 64, 64);
    this.particles = this.makeArray(particleTextures, 32, 32);
    this.weather = weatherTextures ? this.makeArray(weatherTextures, 64, 256, true) : null;
    this.weatherBatch = new Batch();
    this.blockBatch = new Batch(); this.itemBatch = new Batch(); this.entityBatch = new Batch(); this.particleBatch = new Batch();
    this.models = new Map();
    this.spriteMeshes = new Map();
    this.blockMeshes = new Map();
    this.pose = new Pose();
    this.game = null;
  }

  // Build a TEXTURE_2D_ARRAY from a Map name -> {w,h,data} or Uint8ClampedArray(16x16). Each image padded to (W,H).
  makeArray(map, W, H, repeat = false) {
    const gl = this.gl;
    const names = [...map.keys()];
    const layers = new Map();
    const all = new Uint8Array(W * H * 4 * Math.max(1, names.length));
    names.forEach((n, i) => {
      let img = map.get(n);
      if (img instanceof Uint8ClampedArray || img instanceof Uint8Array) img = { w: 16, h: 16, data: img };
      layers.set(n, { layer: i, w: img.w, h: img.h, data: img.data });
      for (let y = 0; y < img.h && y < H; y++) for (let x = 0; x < img.w && x < W; x++) {
        const s = (y * img.w + x) * 4, d = (i * W * H + y * W + x) * 4;
        all[d] = img.data[s]; all[d + 1] = img.data[s + 1]; all[d + 2] = img.data[s + 2]; all[d + 3] = img.data[s + 3];
      }
    });
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, W, H, Math.max(1, names.length), 0, gl.RGBA, gl.UNSIGNED_BYTE, all);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return { tex, layers, W, H };
  }

  // ---------- item geometry ----------
  // Returns a list of triangles in local space [x,y,z,u,v,layer,nx,ny,nz,tint] for an item stack, and which texture array to use.
  itemGeometry(id) {
    const it = ItemById[id];
    if (!it) return null;
    if (it.icon.kind === 'block') return { kind: 'block', tris: this.blockGeometry(it.block), array: 'block' };
    const key = `${it.icon.atlas}:${it.icon.tex}`;
    let mesh = this.spriteMeshes.get(key);
    if (!mesh) {
      mesh = this.buildSprite(it.icon.tex, it.icon.atlas);
      this.spriteMeshes.set(key, mesh);
    }
    return { kind: 'sprite', tris: mesh, array: it.icon.atlas, tint: it.icon.tint };
  }

  spriteSource(tex, atlas) {
    if (atlas === 'block') {
      const e = this.r.textures.get(tex);
      return { layer: e.layer, data: this.r.textures.image(tex), W: 16, H: 16 };
    }
    const e = this.items.layers.get(tex);
    if (!e) return { layer: 0, data: new Uint8ClampedArray(1024), W: 16, H: 16 };
    return { layer: e.layer, data: e.data, W: 16, H: 16 };
  }

  // Extruded sprite: front/back quads plus 1px side walls on the sprite silhouette. Local space 0..1 (x right, y up), z in [7.5/16, 8.5/16].
  buildSprite(tex, atlas) {
    const src = this.spriteSource(tex, atlas);
    const tris = [];
    const L = src.layer;
    const z0 = 7.5 / 16, z1 = 8.5 / 16;
    const q = (pts, uvs, n) => { for (const k of [0, 1, 2, 0, 2, 3]) tris.push([pts[k][0], pts[k][1], pts[k][2], uvs[k][0], uvs[k][1], L, n[0], n[1], n[2]]); };
    q([[0, 1, z1], [0, 0, z1], [1, 0, z1], [1, 1, z1]], [[0, 0], [0, 1], [1, 1], [1, 0]], [0, 0, 1]);
    q([[1, 1, z0], [1, 0, z0], [0, 0, z0], [0, 1, z0]], [[1, 0], [1, 1], [0, 1], [0, 0]], [0, 0, -1]);
    const d = src.data;
    const opaque = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d && d[(y * 16 + x) * 4 + 3] > 127;
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      if (!opaque(px, py)) continue;
      const u0 = (px + 0.1) / 16, u1 = (px + 0.9) / 16, v0 = (py + 0.1) / 16, v1 = (py + 0.9) / 16;
      const X0 = px / 16, X1 = (px + 1) / 16, Y1 = 1 - py / 16, Y0 = 1 - (py + 1) / 16;
      const uv = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      if (!opaque(px - 1, py)) q([[X0, Y1, z0], [X0, Y0, z0], [X0, Y0, z1], [X0, Y1, z1]], uv, [-1, 0, 0]);
      if (!opaque(px + 1, py)) q([[X1, Y1, z1], [X1, Y0, z1], [X1, Y0, z0], [X1, Y1, z0]], uv, [1, 0, 0]);
      if (!opaque(px, py - 1)) q([[X0, Y1, z0], [X0, Y1, z1], [X1, Y1, z1], [X1, Y1, z0]], uv, [0, 1, 0]);
      if (!opaque(px, py + 1)) q([[X0, Y0, z1], [X0, Y0, z0], [X1, Y0, z0], [X1, Y0, z1]], uv, [0, -1, 0]);
    }
    return tris;
  }

  // Block model in local space 0..1 cube (like a block model), using block texture layers
  blockGeometry(blockId, meta = 0) {
    const key = blockId * 16 + meta;
    let g = this.blockMeshes.get(key);
    if (g) return g;
    const def = BlockById[blockId];
    const T = this.r.textures;
    g = [];
    const tintOf = (kind) => kind === 'grass' ? [0x91 / 255, 0xbd / 255, 0x59 / 255] : kind === 'foliage' ? [0x77 / 255, 0xab / 255, 0x2f / 255] : kind === 'birch' ? [0x80 / 255, 0xa7 / 255, 0x55 / 255] : kind === 'spruce' ? [0x61 / 255, 0x99 / 255, 0x61 / 255] : null;
    const addFace = (f, x0, y0, z0, x1, y1, z1, layer, tint, uvo) => {
      const verts = FACE_VERTS[f];
      const n = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][f];
      const pts = verts.map((p) => [p[0] ? x1 : x0, p[1] ? y1 : y0, p[2] ? z1 : z0]);
      const uvs = pts.map((p, k) => {
        if (uvo) return [(uvo[0] + (uvo[2] - uvo[0]) * FACE_UV[k][0]) / 16, (uvo[1] + (uvo[3] - uvo[1]) * FACE_UV[k][1]) / 16];
        const [u, v] = uvFromPos(f, p[0] * 16, p[1] * 16, p[2] * 16);
        return [u / 16, v / 16];
      });
      for (const k of [0, 1, 2, 0, 2, 3]) g.push([pts[k][0], pts[k][1], pts[k][2], uvs[k][0], uvs[k][1], layer, n[0], n[1], n[2], tint]);
    };
    if (def.render === 'cube') {
      for (let f = 0; f < 6; f++) {
        let tex = def.faces[f];
        if (def.front && f === 4) tex = def.front;
        if (def.orient === 'facing' && def.front && f !== 4 && f !== 2 && f !== 3) tex = def.faces[0];
        let tint = null;
        if (def.tint) tint = def.tintTop ? (f === 3 ? tintOf(def.tint) : null) : tintOf(def.tint);
        addFace(f, 0, 0, 0, 1, 1, 1, T.get(tex).layer, tint);
        if (def.overlay && f !== 2 && f !== 3) addFace(f, 0, 0, 0, 1, 1, 1, T.get(def.overlay).layer, tintOf('grass'));
      }
    } else {
      const boxes = getRenderBoxes(def, meta, () => 0);
      for (const bx of boxes) {
        const [x0, y0, z0, x1, y1, z1] = bx.f.map((v) => v / 16);
        for (let f = 0; f < 6; f++) {
          if (bx.faces !== undefined && !(bx.faces & (1 << f))) continue;
          let tex = typeof bx.tex === 'string' ? bx.tex : bx.tex ? bx.tex[f] : def.faces[f];
          if (bx.facing !== undefined && def.front && f === 4) tex = def.front;
          else if (bx.facing !== undefined && def.front && f !== 2 && f !== 3) tex = def.faces[0];
          addFace(f, x0, y0, z0, x1, y1, z1, T.get(tex).layer, def.tint ? tintOf(def.tint) : null, bx.uv && bx.uv[f]);
        }
      }
    }
    this.blockMeshes.set(key, g);
    return g;
  }

  // Emit item geometry through the pose into a batch. light: [sky, blk]
  emitItem(batch, id, pose, light, opts = {}) {
    const geo = this.itemGeometry(id);
    if (!geo) return;
    const white = opts.white ?? 0, alpha = opts.alpha ?? 1;
    const tintItem = geo.tint ? [0x91 / 255, 0xbd / 255, 0x59 / 255] : null;
    for (const t of geo.tris) {
      const [x, y, z, u, v, l, nx, ny, nz, tint] = t;
      const p = pose.apply(x - 0.5, y - 0.5, z - 0.5);
      const n = pose.applyN(nx, ny, nz);
      const sh = opts.flat ? 1 : entityShade(n[0], n[1], n[2]);
      const tc = tint ?? tintItem ?? [1, 1, 1];
      batch.push(p[0], p[1], p[2], u, v, l, tc[0] * sh, tc[1] * sh, tc[2] * sh, alpha, light[0], light[1], white, 0);
    }
    return geo.array;
  }

  batchFor(array) { return array === 'block' ? this.blockBatch : array === 'item' ? this.itemBatch : array === 'entity' ? this.entityBatch : this.particleBatch; }

  // ---------- entity models ----------
  model(key) {
    let m = this.models.get(key);
    if (!m) {
      if (key.startsWith('armor_')) m = MODELS[key.endsWith('_2') ? 'armor2' : 'armor1'](key);
      else m = MODELS[key]();
      this.models.set(key, m);
    }
    return m;
  }

  emitModel(type, texName, e, t, world, camPos, light, opts = {}) {
    const m = this.model(opts.modelKey ?? type);
    const entry = this.entities.layers.get(texName);
    if (!entry) return;
    const layer = entry.layer;
    const pos = e.lerpPos(t);
    const bodyYaw = lerpAng(e.pbodyYaw ?? e.pyaw, e.bodyYaw ?? e.yaw, t);
    const headYaw = lerpAng(e.pheadYaw ?? e.pyaw, e.headYaw ?? e.yaw, t);
    const pitch = e.ppitch + (e.pitch - e.ppitch) * t;
    const age = e.age + t;
    const la = (e.prevLimbSwingAmount ?? 0) + ((e.limbSwingAmount ?? 0) - (e.prevLimbSwingAmount ?? 0)) * t;
    const ls = (e.limbSwing ?? 0) - (e.limbSwingAmount ?? 0) * (1 - t);
    const attack = (e.pattackAnim ?? 0) + ((e.attackAnim ?? 0) - (e.pattackAnim ?? 0)) * t;
    const state = {
      limbSwing: ls, limbAmount: Math.min(1, la), ageInTicks: age, headYaw: wrap(headYaw - bodyYaw), headPitch: pitch,
      attackAnim: attack, sneaking: !!e.sneaking, zombieArms: type === 'zombie', aggressive: !!e.aggressive,
      bowPose: type === 'skeleton' && !!e.target, holding: !!e.equipment?.mainhand && type === 'player', blocking: !!e.blocking,
      eatAnim: e.eatTime ?? 0, flap: type === 'chicken' ? (Math.sin(e.oflap + (e.flap - e.oflap) * t) + 1) * (e.oFlapSpeed + (e.flapSpeed - e.oFlapSpeed) * t) : 0,
      angry: !!e.angry,
    };
    animate(opts.animKey ?? type, m, state);
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1], pos[2] - camPos[2]);
    pose.ry(bodyYaw * 180 / Math.PI);
    // death animation: fall over sideways
    if (e.dead && e.deathTime !== undefined) {
      let f = (e.deathTime + t - 1) / 20 * 1.6;
      f = Math.sqrt(Math.max(0, f)); if (f > 1) f = 1;
      pose.rz(f * 90);
    }
    let scale = (e.baby ? 0.5 : 1) * (opts.scale ?? 1);
    const white = opts.white ?? 0;
    // creeper swelling
    let sx = 1, sy = 1;
    if (opts.stretch) { sx = opts.stretch[0]; sy = opts.stretch[1]; }
    if (type === 'creeper' && e.swelling) {
      let f = e.swelling(t);
      const f1 = 1 + Math.sin(f * 100) * f * 0.01;
      f = Math.max(0, Math.min(1, f)); f *= f; f *= f;
      sx = (1 + f * 0.4) * f1; sy = (1 + f * 0.1) / f1;
    }
    pose.s(scale * sx / 16, scale * sy / 16, scale * sx / 16);
    const red = (e.hurtTime > 0 || e.dead) ? 1 : 0;
    const tint = opts.tint ?? [1, 1, 1];
    const batch = this.entityBatch;
    const W = 64, H = 64;
    const texScaleU = m.texW / W, texScaleV = m.texH / H;
    buildModel(m, (x, y, z, u, v, nx, ny, nz) => {
      const p = pose.apply(x, y, z);
      const n = pose.applyN(nx, ny, nz);
      const sh = entityShade(n[0], n[1], n[2]);
      batch.push(p[0], p[1], p[2], u * texScaleU, v * texScaleV, layer, tint[0] * sh, tint[1] * sh, tint[2] * sh, 1, light[0], light[1], white, red);
    });
    return { pose, bodyYaw, pos, model: m };
  }

  lightAt(world, x, y, z) {
    const l = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    return [(l >> 4) / 15, (l & 15) / 15];
  }

  // ---------- frame ----------
  renderOpaque(ctx) {
    const game = this.game;
    if (!game) return;
    const { world, camPos } = ctx;
    const t = ctx.opts.partial;
    this.blockBatch.reset(); this.itemBatch.reset(); this.entityBatch.reset(); this.particleBatch.reset();
    const player = game.player;
    const rd = ctx.opts.renderDistance * 16;
    for (const e of game.entities.list) {
      if (e.removed && !e.isPlayer) continue;
      if (e === player && !ctx.cam.thirdPerson) continue;
      if (e.isPlayer && e.spectator) continue;
      const pos = e.lerpPos(t);
      const dx = pos[0] - camPos[0], dy = pos[1] - camPos[1], dz = pos[2] - camPos[2];
      if (dx * dx + dz * dz > rd * rd) continue;
      if (!this.visible(ctx, pos, e)) continue;
      const light = this.lightAt(world, pos[0], pos[1] + (e.eyeHeight ?? 0.5), pos[2]);
      if (e.fireTicks > 0 && (e.isLiving)) game.fx?.fireOnEntity?.(e);
      switch (e.type) {
        case 'item': this.drawItemEntity(e, t, camPos, light); break;
        case 'xp_orb': this.drawXpOrb(e, t, camPos, light, ctx); break;
        case 'falling_block': this.drawBlockEntity(e, e.value, t, camPos, light, 0); break;
        case 'tnt': {
          const fuse = e.fuse - t + 1;
          const white = (Math.floor(fuse / 5) % 2 === 0) ? 0.6 : 0;
          let s = 1;
          if (fuse < 10) { let f = 1 - fuse / 10; f = Math.max(0, Math.min(1, f)); f *= f; f *= f; s = 1 + f * 0.3; }
          this.drawBlockEntity(e, B.tnt, t, camPos, light, white, s);
          break;
        }
        case 'arrow': this.drawArrow(e, t, camPos, light); break;
        case 'thrown': this.drawThrown(e, t, camPos, light, ctx); break;
        case 'player': this.drawPlayer(e, t, world, camPos, light); break;
        case 'sheep': {
          this.emitModel('sheep', 'sheep', e, t, world, camPos, light);
          if (!e.sheared) this.emitModel('sheep_fur', 'sheep_fur', e, t, world, camPos, light, { modelKey: 'sheep_fur', animKey: 'sheep_fur', tint: woolTint(e.color) });
          break;
        }
        case 'creeper': {
          const f = e.swelling ? e.swelling(t) : 0;
          const white = Math.floor(f * 10) % 2 === 0 ? 0 : Math.max(0, Math.min(1, f)) * 0.5 + 0.2;
          this.emitModel('creeper', 'creeper', e, t, world, camPos, light, { white });
          break;
        }
        case 'zombified_piglin':
          this.emitModel('zombified_piglin', 'zombified_piglin', e, t, world, camPos, light);
          if (e.equipment?.mainhand) this.drawHeldByMob(e, t, camPos, light);
          break;
        case 'ghast':
          this.emitModel('ghast', e.shooting ? 'ghast_shooting' : 'ghast', e, t, world, camPos, light, { scale: 4.5, modelKey: 'ghast', animKey: 'ghast' });
          break;
        case 'blaze':
          this.emitModel('blaze', 'blaze', e, t, world, camPos, [light[0], 1]);
          break;
        case 'magma_cube': {
          const size = e.cubeSize ?? 1;
          const sq = ((e.oSquish ?? 0) + ((e.squish ?? 0) - (e.oSquish ?? 0)) * t) / (size * 0.5 + 1);
          const k = 1 / (sq + 1);
          this.emitModel('magma_cube', 'magma_cube', e, t, world, camPos, [light[0], 1], { scale: size, stretch: [k, 1 / k] });
          break;
        }
        case 'fireball': case 'small_fireball':
          this.drawSprite(e, t, camPos, [light[0], 1], ctx, 'fire_charge', e.type === 'fireball' ? 1.5 : 0.375);
          break;
        default:
          if (MODELS[e.type]) {
            this.emitModel(e.type, e.type, e, t, world, camPos, light);
            if (e.type === 'skeleton' && e.equipment?.mainhand) this.drawHeldByMob(e, t, camPos, light, 'bow');
            if (e.type === 'zombie' && e.equipment?.mainhand) this.drawHeldByMob(e, t, camPos, light);
          }
      }
      if (e.fireTicks > 0 && e.isLiving) this.drawFireOverlay(e, t, camPos);
    }
    // block entities: chest lids etc. are part of the block mesh; enchanting books float above tables
    this.drawEnchantBooks(ctx);
    this.flush(ctx, 0.1);
  }

  visible(ctx, pos, e) {
    const w = (e.width ?? 1) / 2 + 0.5, h = (e.height ?? 1) + 0.5;
    const cx = pos[0] - ctx.camPos[0], cy = pos[1] - ctx.camPos[1], cz = pos[2] - ctx.camPos[2];
    const p = ctx.frustum;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i], b = p[i + 1], c = p[i + 2], d = p[i + 3];
      const x = a > 0 ? cx + w : cx - w, y = b > 0 ? cy + h : cy - 0.5, z = c > 0 ? cz + w : cz - w;
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }

  drawPlayer(e, t, world, camPos, light) {
    const res = this.emitModel('player', 'player', e, t, world, camPos, light);
    if (!res) return;
    // armor layers
    const pieces = [['head', 1], ['chest', 1], ['legs', 2], ['feet', 1]];
    for (const [slot, layerN] of pieces) {
      const s = e.equipment?.[slot];
      if (!s || !s.item?.armor) continue;
      const mat = s.item.material;
      const tex = `armor_${mat}_${layerN}`;
      if (!this.entities.layers.has(tex)) continue;
      const m = this.model(tex);
      const vis = { head: slot === 'head', body: slot === 'chest' || slot === 'legs', rightArm: slot === 'chest', leftArm: slot === 'chest', rightLeg: slot === 'legs' || slot === 'feet', leftLeg: slot === 'legs' || slot === 'feet' };
      for (const [k, p] of Object.entries(m.root.children)) p.visible = !!vis[k];
      this.emitModel('player', tex, e, t, world, camPos, light, { modelKey: tex, animKey: 'armor1' });
    }
    // held item (third person)
    const held = e.inventory?.held;
    if (held) this.drawHeldThirdPerson(e, t, camPos, light, held.id, res);
  }

  drawHeldThirdPerson(e, t, camPos, light, id, res) {
    const pose = this.pose;
    const pos = res.pos;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1], pos[2] - camPos[2]);
    pose.ry(res.bodyYaw * 180 / Math.PI);
    // follow right arm pivot + rotation
    const arm = res.model.root.children.rightArm;
    pose.t(arm.pivot[0] / 16, arm.pivot[1] / 16, arm.pivot[2] / 16);
    pose.rz(arm.rz * 180 / Math.PI); pose.ry(arm.ry * 180 / Math.PI); pose.rx(-arm.rx * 180 / Math.PI * -1);
    pose.t(0, -10 / 16, -1 / 16);
    const it = ItemById[id];
    if (it.icon.kind === 'block') { pose.rx(-90 + 75); pose.s(0.375); }
    else { pose.rx(-90); pose.ry(90); pose.rz(-55); pose.s(0.85); pose.t(0, 0.1, 0); }
    const arr = this.emitItem(this.batchFor(it.icon.kind === 'block' ? 'block' : it.icon.atlas), id, pose, light);
    void arr;
  }

  drawHeldByMob(e, t, camPos, light, which) {
    const s = e.equipment.mainhand;
    if (!s) return;
    const pose = this.pose;
    const pos = e.lerpPos(t);
    const bodyYaw = lerpAng(e.pbodyYaw, e.bodyYaw, t);
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1], pos[2] - camPos[2]);
    pose.ry(bodyYaw * 180 / Math.PI);
    pose.t(5 / 16, 20 / 16, which === 'bow' && e.target ? -8 / 16 : 0);
    if (which === 'bow' && e.target) { pose.rx(-80); }
    pose.rx(-20); pose.ry(90); pose.s(0.7);
    const it = ItemById[s.id];
    this.emitItem(this.batchFor(it.icon.kind === 'block' ? 'block' : it.icon.atlas), s.id, pose, light);
  }

  drawItemEntity(e, t, camPos, light) {
    const pos = e.lerpPos(t);
    if (e.pickupAnim) {
      const tgt = e.pickupAnim.target;
      const f = Math.min(1, (e.pickupAnim.t + t) / 3);
      const tp = tgt.lerpPos(t);
      pos[0] += (tp[0] - pos[0]) * f * f; pos[1] += (tp[1] + 0.8 - pos[1]) * f * f; pos[2] += (tp[2] - pos[2]) * f * f;
    }
    const s = e.stack;
    if (!s) return;
    const it = ItemById[s.id];
    if (!it) return;
    const age = e.age + t;
    const bob = Math.sin(age / 10 + e.bobOffset) * 0.1 + 0.1;
    const spin = age / 20 + e.bobOffset;
    const isBlock = it.icon.kind === 'block';
    const copies = s.count > 48 ? 5 : s.count > 32 ? 4 : s.count > 16 ? 3 : s.count > 1 ? 2 : 1;
    const pose = this.pose;
    const batch = this.batchFor(isBlock ? 'block' : it.icon.atlas);
    for (let i = 0; i < copies; i++) {
      pose.m = mat4.identity(mat4.create());
      pose.t(pos[0] - camPos[0], pos[1] - camPos[1] + bob + (isBlock ? 0.125 : 0.125), pos[2] - camPos[2]);
      pose.ry(spin * 180 / Math.PI);
      if (i > 0) {
        const r = mulberry(e.id * 31 + i);
        if (isBlock) pose.t((r() * 2 - 1) * 0.15, (r() * 2 - 1) * 0.15, (r() * 2 - 1) * 0.15);
        else pose.t((r() * 2 - 1) * 0.075, (r() * 2 - 1) * 0.075, -0.09375 * i);
      }
      pose.s(isBlock ? 0.25 : 0.5);
      this.emitItem(batch, s.id, pose, light);
    }
  }

  drawBlockEntity(e, value, t, camPos, light, white, scale = 1) {
    const pos = e.lerpPos(t);
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1] + 0.5 * scale, pos[2] - camPos[2]);
    pose.s(scale);
    const id = value & ID_MASK;
    const geo = this.blockGeometry(id, value >>> 12);
    for (const tri of geo) {
      const [x, y, z, u, v, l, nx, ny, nz, tint] = tri;
      const p = pose.apply(x - 0.5, y - 0.5, z - 0.5);
      const sh = entityShade(nx, ny, nz);
      const tc = tint ?? [1, 1, 1];
      this.blockBatch.push(p[0], p[1], p[2], u, v, l, tc[0] * sh, tc[1] * sh, tc[2] * sh, 1, light[0], light[1], white, 0);
    }
  }

  drawArrow(e, t, camPos, light) {
    const pos = e.lerpPos(t);
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1] + 0.25, pos[2] - camPos[2]);
    const yaw = lerpAng(e.pyaw, e.yaw, t), pitch = e.ppitch + (e.pitch - e.ppitch) * t;
    pose.ry(yaw * 180 / Math.PI);
    pose.rx(pitch * 180 / Math.PI);
    if (e.shake > 0) pose.rx(-Math.sin((e.shake - t) * 3) * (e.shake - t) * 0.5 * 2);
    // arrow sprite points up-right; rotate so the tip points along -Z
    pose.rx(-90); pose.rz(45 + 180);
    pose.s(0.9, 0.9, 0.9);
    this.emitItem(this.itemBatch, Items.arrow.id, pose, light);
  }

  // camera-facing item sprite (fireballs); size in blocks
  drawSprite(e, t, camPos, light, ctx, itemName, size) {
    const pos = e.lerpPos(t);
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1] + e.height / 2, pos[2] - camPos[2]);
    pose.ry(ctx.cam.yaw * 180 / Math.PI); pose.rx(ctx.cam.pitch * 180 / Math.PI);
    pose.s(size);
    pose.t(0, -0.5, 0);
    const it = Items[itemName];
    if (it) this.emitItem(this.itemBatch, it.id, pose, light, { flat: true });
  }

  // floating books above enchanting tables (EnchantTableRenderer)
  drawEnchantBooks(ctx) {
    const game = this.game, tables = game.enchTables;
    if (!tables || tables.size === 0) return;
    const t = ctx.opts.partial, camPos = ctx.camPos;
    const m = this.model('enchanting_table_book');
    const entry = this.entities.layers.get('enchanting_table_book');
    if (!entry) return;
    for (const b of tables.values()) {
      if (!b.anim) continue;
      const dx = b.x + 0.5 - camPos[0], dy = b.y + 0.75 - camPos[1], dz = b.z + 0.5 - camPos[2];
      if (dx * dx + dy * dy + dz * dz > 64 * 64) continue;
      const a = b.anim;
      const time = a.time + t;
      let rot = a.rot - a.oRot;
      while (rot >= Math.PI) rot -= Math.PI * 2;
      while (rot < -Math.PI) rot += Math.PI * 2;
      rot = a.oRot + rot * t;
      const flip = a.oFlip + (a.flip - a.oFlip) * t;
      const frac = (x) => x - Math.floor(x);
      const f1 = Math.max(0, Math.min(1, frac(flip + 0.25) * 1.6 - 0.3));
      const f2 = Math.max(0, Math.min(1, frac(flip + 0.75) * 1.6 - 0.3));
      const open = a.oOpen + (a.open - a.oOpen) * t;
      animate('enchanting_table_book', m, { ageInTicks: time, flip1: f1, flip2: f2, open });
      const pose = this.pose;
      pose.m = mat4.identity(mat4.create());
      pose.t(dx, dy + 0.1 + Math.sin(time * 0.1) * 0.01, dz);
      pose.ry(-rot * 180 / Math.PI);
      pose.rz(80);
      pose.s(1 / 16);
      const l = this.lightAt(game.world, b.x + 0.5, b.y + 1, b.z + 0.5);
      const batch = this.entityBatch;
      const texScaleU = m.texW / 64, texScaleV = m.texH / 64;
      buildModel(m, (x, y, z, u, v, nx, ny, nz) => {
        const p = pose.apply(x, y, z);
        const n = pose.applyN(nx, ny, nz);
        const sh = entityShade(n[0], n[1], n[2]);
        batch.push(p[0], p[1], p[2], u * texScaleU, v * texScaleV, entry.layer, sh, sh, sh, 1, l[0], l[1], 0, 0);
      });
    }
  }

  drawThrown(e, t, camPos, light, ctx) {
    const pos = e.lerpPos(t);
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    pose.t(pos[0] - camPos[0], pos[1] - camPos[1] + 0.125, pos[2] - camPos[2]);
    pose.ry(ctx.cam.yaw * 180 / Math.PI); pose.rx(ctx.cam.pitch * 180 / Math.PI);
    pose.s(0.5);
    const it = Items[e.itemName];
    if (it) this.emitItem(this.itemBatch, it.id, pose, light, { flat: true });
  }

  drawXpOrb(e, t, camPos, light, ctx) {
    const pos = e.lerpPos(t);
    const idx = XpOrb.sizeIndex(e.value);
    const entry = this.particles.layers.get(`xp_orb_${idx}`);
    if (!entry) return;
    const age = e.age + t;
    const f = (Math.sin(age / 2) + 1) * 0.5;
    const r = 1, g = (Math.sin(age / 2 + 0) + 1) * 0.1 + 0.8, b = 0;
    void f;
    this.billboard(this.particleBatch, pos[0] - camPos[0], pos[1] - camPos[1] + 0.25, pos[2] - camPos[2], 0.3, entry, ctx.cam, [r, g, b, 1], [1, 1]);
    void light;
  }

  billboard(batch, x, y, z, size, entry, cam, color, light, uv = null) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // camera right and up vectors
    const rx = cy, rz = -sy;
    const ux = -sy * -sp, uy = cp, uz = -cy * -sp;
    const W = entry.w / this.particles.W, H = entry.h / this.particles.H;
    const [u0, v0, u1, v1] = uv ?? [0, 0, W, H];
    const pts = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
    const uvs = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
    const wx = size * (entry.w / Math.max(entry.w, entry.h)), hy = size * (entry.h / Math.max(entry.w, entry.h));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [a, b] = pts[k];
      batch.push(x + rx * a * wx + ux * b * hy, y + uy * b * hy, z + rz * a * wx + uz * b * hy, uvs[k][0], uvs[k][1], entry.layer, color[0], color[1], color[2], color[3], light[0], light[1], 0, 0);
    }
  }

  drawFireOverlay(e, t, camPos) {
    // flickering fire texture quads around burning entities
    const pos = e.lerpPos(t);
    const fire = this.r.textures.get('fire_0');
    const frame = Math.floor((performance.now() / 50)) % 16;
    const layer = fire.layer + frame;
    const w = e.width * 1.4 / 2, h = e.height * 1.4;
    const x = pos[0] - camPos[0], y = pos[1] - camPos[1], z = pos[2] - camPos[2];
    const quads = [[[-w, h, -w], [-w, 0, -w], [w, 0, w], [w, h, w]], [[-w, h, w], [-w, 0, w], [w, 0, -w], [w, h, -w]]];
    for (const q of quads) for (const dir of [0, 1]) for (const k of [0, 1, 2, 0, 2, 3]) {
      const kk = dir ? 3 - k : k;
      const p = q[kk];
      this.blockBatch.push(x + p[0], y + p[1], z + p[2], FACE_UV[kk][0], FACE_UV[kk][1], layer, 1, 1, 1, 1, 1, 1, 0, 0);
    }
  }

  flush(ctx, alphaCut, blend = false) {
    const gl = this.gl;
    const p = this.prog.use();
    gl.uniformMatrix4fv(p.u.u_viewProj, false, ctx.viewProj);
    gl.uniform3fv(p.u.u_fogColor, ctx.env.fogColor);
    gl.uniform2f(p.u.u_fog, ctx.env.fogStart, ctx.env.fogEnd);
    gl.uniform1f(p.u.u_alphaCut, alphaCut);
    gl.uniform1f(p.u.u_fullbright, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.lightmap.tex);
    gl.uniform1i(p.u.u_lightmap, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    gl.bindVertexArray(this.vao);
    const draws = [[this.entityBatch, this.entities.tex], [this.blockBatch, this.r.textures.texture], [this.itemBatch, this.items.tex], [this.particleBatch, this.particles.tex]];
    for (const [b, tex] of draws) {
      if (!b.n) continue;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.n * FLOATS), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, b.n);
    }
    if (blend) { gl.disable(gl.BLEND); gl.depthMask(true); }
    gl.bindVertexArray(null);
  }

  renderTranslucent(ctx) {
    const game = this.game;
    if (!game || !game.fx) return;
    this.blockBatch.reset(); this.itemBatch.reset(); this.entityBatch.reset(); this.particleBatch.reset();
    game.fx.render(this, ctx);
    // xp orbs & sprite particles use alpha blending
    this.flush(ctx, 0.01, true);
    this.renderWeather(ctx);
  }

  // Vanilla LevelRenderer.renderSnowAndRain: textured vertical quads in columns around the camera
  renderWeather(ctx) {
    const w = ctx.world;
    if (!this.weather || w.rain <= 0.001) return;
    const gl = this.gl, cp = ctx.camPos, t = ctx.opts.partial;
    const ticks = w.time + t;
    const R = this.game.settings.graphics === 'fancy' ? 10 : 5;
    const bx = Math.floor(cp[0]), by = Math.floor(cp[1]), bz = Math.floor(cp[2]);
    const batch = this.weatherBatch;
    batch.reset();
    const rainLayer = this.weather.layers.get('rain')?.layer ?? 0, snowLayer = this.weather.layers.get('snow')?.layer ?? 0;
    for (let z = bz - R; z <= bz + R; z++) for (let x = bx - R; x <= bx + R; x++) {
      const dxc = x + 0.5 - cp[0], dzc = z + 0.5 - cp[2];
      const d2 = dxc * dxc + dzc * dzc;
      if (d2 > R * R) continue;
      const biome = w.getBiomeDef(x, z);
      if (biome.downfall <= 0) continue; // deserts, savannas, badlands
      const h = w.getHeight(x, z) + 1;
      const y0 = Math.max(by - R, h), y1 = Math.max(by + R, h);
      if (y0 >= y1) continue;
      const snowy = biome.snowy && !(biome.temperature >= 0.15);
      const len = Math.sqrt(d2) || 1;
      // quad perpendicular to the view direction of this column
      const ox = -dzc / len * 0.5, oz = dxc / len * 0.5;
      const seed = (x * x * 3121 + x * 45238971 + z * z * 418711 + z * 13761) & 31;
      let v0, u0 = 0;
      if (snowy) {
        v0 = -((ticks & 511) + t) / 512;
        u0 = Math.sin(ticks * 0.01 + seed) * 0.05 + (seed / 32) * 0.3;
      } else v0 = -(((ticks + seed) % 32) / 32) * (3 + (seed % 7) / 7);
      const alpha = ((1 - d2 / (R * R)) * 0.5 + 0.5) * w.rain;
      const l = w.getLight(x, Math.max(h, by), z);
      const sky = (l >> 4) / 15, blk = (l & 15) / 15;
      const X = x + 0.5 - cp[0], Z = z + 0.5 - cp[2];
      const Y0 = y0 - cp[1], Y1 = y1 - cp[1];
      const pts = [[X - ox, Y1, Z - oz, u0, y1 * 0.25 + v0], [X - ox, Y0, Z - oz, u0, y0 * 0.25 + v0], [X + ox, Y0, Z + oz, u0 + 1, y0 * 0.25 + v0], [X + ox, Y1, Z + oz, u0 + 1, y1 * 0.25 + v0]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const q = pts[k];
        batch.push(q[0], q[1], q[2], q[3], q[4], snowy ? snowLayer : rainLayer, 1, 1, 1, alpha, sky, blk, 0, 0);
      }
    }
    if (!batch.n) return;
    const p = this.prog.use();
    gl.uniformMatrix4fv(p.u.u_viewProj, false, ctx.viewProj);
    gl.uniform3fv(p.u.u_fogColor, ctx.env.fogColor);
    gl.uniform2f(p.u.u_fog, ctx.env.fogStart, ctx.env.fogEnd);
    gl.uniform1f(p.u.u_alphaCut, 0.01);
    gl.uniform1f(p.u.u_fullbright, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.lightmap.tex); gl.uniform1i(p.u.u_lightmap, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.weather.tex); gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n * FLOATS), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, batch.n);
    gl.bindVertexArray(null);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // ---------- first person hand ----------
  renderOverlay(ctx) {
    const game = this.game;
    if (!game || !game.player || ctx.cam.thirdPerson || game.hideHand) return;
    const p = game.player;
    if (p.spectator || p.dead || p.sleeping) return;
    const gl = this.gl;
    const t = ctx.opts.partial;
    this.blockBatch.reset(); this.itemBatch.reset(); this.entityBatch.reset(); this.particleBatch.reset();
    const light = this.lightAt(ctx.world, p.x, p.y + p.eyeHeight, p.z);
    const hand = game.handState; // { equipMain, equipOff, swing }
    const swing = p.pattackAnim + (p.attackAnim - p.pattackAnim) * t;
    const main = p.inventory.held, off = p.inventory.offhand;
    const equipMain = hand ? hand.oMain + (hand.main - hand.oMain) * t : 0;
    const equipOff = hand ? hand.oOff + (hand.off - hand.oOff) * t : 0;
    const usingMain = p.isUsingItem && p.useHand === 'main', usingOff = p.isUsingItem && p.useHand === 'off';
    this.renderArmWithItem(p, t, 1, usingOff ? 0 : swing, main, equipMain, light, usingMain);
    if (off || usingOff) this.renderArmWithItem(p, t, -1, usingOff ? swing : 0, off, equipOff, light, usingOff);
    // hand camera: fixed 70 fov, cleared depth
    const proj = mat4.perspective(mat4.create(), 70 * Math.PI / 180, this.r.width / this.r.height, 0.05, 100);
    const view = mat4.identity(mat4.create());
    // view bobbing applies to the hand too
    const cam = ctx.cam;
    if (cam.bob) { mat4.translate(view, view, cam.bob.x, cam.bob.y, 0); mat4.rotateZ(view, view, cam.bob.rz); mat4.rotateX(view, view, cam.bob.rx); }
    if (cam.roll) mat4.rotateZ(view, view, cam.roll);
    const vp = mat4.multiply(mat4.create(), proj, view);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.flush({ ...ctx, viewProj: vp, env: { ...ctx.env, fogStart: 1000, fogEnd: 2000 } }, 0.1);
  }

  renderArmWithItem(p, t, side, swing, stack, equip, light, using) {
    const pose = this.pose;
    pose.m = mat4.identity(mat4.create());
    // sway with look delta (item in hand follows the camera slightly)
    const hs = this.game.handSway;
    if (hs) { pose.rx(hs.pitch * 0.1 * 57.3 * 0); }
    if (!stack) {
      if (side < 0) return;
      this.renderPlayerArm(side, swing, equip, light);
      return;
    }
    const it = stack.item;
    const useTicks = p.useTicks + t;
    if (using && it.food) {
      this.applyEatTransform(side, useTicks, 32);
      this.applyItemArmTransform(side, equip);
    } else if (using && it.use === 'drink_milk') {
      this.applyEatTransform(side, useTicks, 32);
      this.applyItemArmTransform(side, equip);
    } else if (using && it.use === 'bow') {
      this.applyItemArmTransform(side, equip);
      pose.t(side * -0.2785682, 0.18344387, 0.15731531);
      pose.rx(-13.935); pose.ry(side * 35.3); pose.rz(side * -9.785);
      let f = useTicks / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1;
      if (f > 0.1) { const f15 = Math.sin((useTicks - 0.1) * 1.3); pose.t(0, f15 * (f - 0.1) * 0.004, 0); }
      pose.t(0, 0, f * 0.04);
      pose.s(1, 1, 1 + f * 0.2);
      pose.ry(side * -45);
    } else if (using && it.use === 'shield') {
      this.applyItemArmTransform(side, equip);
      pose.t(side * -0.14142136, 0.08, 0.14142136);
      pose.rx(-102.25); pose.ry(side * 13.365); pose.rz(side * 78.05);
    } else {
      const f = -0.4 * Math.sin(Math.sqrt(swing) * Math.PI), f1 = 0.2 * Math.sin(Math.sqrt(swing) * Math.PI * 2), f2 = -0.2 * Math.sin(swing * Math.PI);
      pose.t(side * f, f1, f2);
      this.applyItemArmTransform(side, equip);
      this.applyItemArmAttackTransform(side, swing);
    }
    // item display transform (first person)
    const isBlock = it.icon.kind === 'block';
    if (it.use === 'shield') {
      this.renderShield(side, light);
      return;
    }
    let tex = it.icon.tex;
    if (it.use === 'bow' && using) {
      const u = useTicks;
      tex = u >= 18 ? 'bow_pulling_2' : u > 13 ? 'bow_pulling_1' : 'bow_pulling_0';
    }
    if (isBlock) {
      pose.ry(45 * side); pose.s(0.4);
      this.emitItem(this.blockBatch, stack.id, pose, light);
    } else {
      pose.t(side * 1.13 / 16, 3.2 / 16, 1.13 / 16);
      pose.ry(-90 * side); pose.rz(25 * side);
      pose.s(0.68);
      if (tex !== it.icon.tex) {
        const geo = this.buildSpriteCached(tex);
        this.emitTris(this.itemBatch, geo, pose, light);
      } else this.emitItem(this.batchFor(it.icon.atlas), stack.id, pose, light);
    }
  }

  buildSpriteCached(tex) {
    const key = `item:${tex}`;
    let m = this.spriteMeshes.get(key);
    if (!m) { m = this.buildSprite(tex, 'item'); this.spriteMeshes.set(key, m); }
    return m;
  }
  emitTris(batch, tris, pose, light) {
    for (const t of tris) {
      const [x, y, z, u, v, l, nx, ny, nz] = t;
      const p = pose.apply(x - 0.5, y - 0.5, z - 0.5);
      const n = pose.applyN(nx, ny, nz);
      const sh = entityShade(n[0], n[1], n[2]);
      batch.push(p[0], p[1], p[2], u, v, l, sh, sh, sh, 1, light[0], light[1], 0, 0);
    }
  }

  applyItemArmTransform(side, equip) { this.pose.t(side * 0.56, -0.52 + equip * -0.6, -0.72); }
  applyItemArmAttackTransform(side, swing) {
    const f = Math.sin(swing * swing * Math.PI);
    this.pose.ry(side * (45 + f * -20));
    const f1 = Math.sin(Math.sqrt(swing) * Math.PI);
    this.pose.rz(side * f1 * -20);
    this.pose.rx(f1 * -80);
    this.pose.ry(side * -45);
  }
  applyEatTransform(side, useTicks, total) {
    const remaining = total - useTicks + 1;
    const f1 = remaining / total;
    if (f1 < 0.8) { const f2 = Math.abs(Math.cos(remaining / 4 * Math.PI) * 0.1); this.pose.t(0, f2, 0); }
    const f3 = 1 - Math.pow(Math.max(0, f1), 27);
    this.pose.t(side * f3 * 0.6, f3 * -0.5, 0);
    this.pose.ry(side * f3 * 90); this.pose.rx(f3 * 10); this.pose.rz(side * f3 * 30);
  }

  renderPlayerArm(side, swing, equip, light) {
    const pose = this.pose;
    const f1 = Math.sqrt(swing);
    const f2 = -0.3 * Math.sin(f1 * Math.PI), f3 = 0.4 * Math.sin(f1 * Math.PI * 2), f4 = -0.4 * Math.sin(swing * Math.PI);
    pose.t(side * (f2 + 0.64000005), f3 - 0.6 + equip * -0.6, f4 - 0.71999997);
    pose.ry(side * 45);
    const f5 = Math.sin(swing * swing * Math.PI), f6 = Math.sin(f1 * Math.PI);
    pose.ry(side * f6 * 70); pose.rz(side * f5 * -20);
    pose.t(side * -1, 3.6, 3.5);
    pose.rz(side * 120); pose.rx(200); pose.ry(side * -135);
    pose.t(side * 5.6, 0, 0);
    // vanilla arm part: box (-3,-2,-2) size 4x12x4 at pivot (-5, 2, 0) in vanilla model space (Y down); units px/16
    pose.s(1 / 16);
    pose.t(-5, 2, 0);
    const m = this.model('player');
    const entry = this.entities.layers.get('player');
    if (!entry) return;
    const arm = { ...m.root.children.rightArm, rx: 0, ry: 0, rz: 0, children: {} };
    const tmp = { texture: 'player', texW: 64, texH: 64, root: { pivot: [0, 0, 0], boxes: [], children: { a: arm }, rx: 0, ry: 0, rz: 0, visible: true } };
    buildModel(tmp, (x, y, z, u, v, nx, ny, nz) => {
      // our space -> vanilla model space: x' = -x, y' = 24 - y; relative to vanilla pivot (-5, 2)
      const vx = -x - (-5), vy = (24 - y) - 2, vz = z;
      const p = pose.apply(vx, vy, vz);
      const n = pose.applyN(-nx, -ny, nz);
      const sh = entityShade(n[0], n[1], n[2]);
      this.entityBatch.push(p[0], p[1], p[2], u, v, entry.layer, sh, sh, sh, 1, light[0], light[1], 0, 0);
    });
  }

  renderShield(side, light) {
    const pose = this.pose;
    const entry = this.entities.layers.get('shield');
    if (!entry) return;
    // vanilla shield item transform (first person right hand): rotate & place, then model scale
    pose.t(side * 0.2, 0.05, 0.05);
    pose.ry(side * 90);
    pose.s(1 / 16);
    pose.t(0, -8, 0);
    const shield = {
      texture: 'shield', texW: 64, texH: 64,
      root: { pivot: [0, 0, 0], boxes: [], rx: 0, ry: 0, rz: 0, visible: true, children: {
        plate: { pivot: [0, 0, 0], rx: 0, ry: 0, rz: 0, visible: true, children: {}, boxes: [{ from: [-6, -11, -2], size: [12, 22, 1], uv: [0, 0], inflate: 0, mirror: false }] },
        handle: { pivot: [0, 0, 0], rx: 0, ry: 0, rz: 0, visible: true, children: {}, boxes: [{ from: [-1, -3, -1], size: [2, 6, 6], uv: [26, 0], inflate: 0, mirror: false }] },
      } },
    };
    buildModel(shield, (x, y, z, u, v, nx, ny, nz) => {
      const p = pose.apply(x, y + 8, z);
      const n = pose.applyN(nx, ny, nz);
      const sh = entityShade(n[0], n[1], n[2]);
      this.entityBatch.push(p[0], p[1], p[2], u, v, entry.layer, sh, sh, sh, 1, light[0], light[1], 0, 0);
    });
  }
}

function lerpAng(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WOOL_TINTS = {
  white: [1, 1, 1], orange: [0.976, 0.502, 0.114], magenta: [0.78, 0.306, 0.741], light_blue: [0.227, 0.702, 0.855],
  yellow: [0.996, 0.847, 0.239], lime: [0.502, 0.78, 0.122], pink: [0.953, 0.545, 0.667], gray: [0.278, 0.31, 0.322],
  light_gray: [0.616, 0.616, 0.592], cyan: [0.086, 0.612, 0.612], purple: [0.537, 0.196, 0.722], blue: [0.235, 0.267, 0.667],
  brown: [0.514, 0.329, 0.196], green: [0.369, 0.486, 0.086], red: [0.69, 0.18, 0.149], black: [0.114, 0.114, 0.129],
};
function woolTint(c) { return WOOL_TINTS[c] ?? [1, 1, 1]; }
export { MIN_Y };
