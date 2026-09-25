// GUI item icons: flat sprites for items, isometric 3D renders for block items (rendered once with WebGL).
import { ItemById } from '../registry/items.js';
import { BlockById } from '../registry/blocks.js';
import { mat4 } from '../util/math.js';
import { makeCanvas } from '../ui/gui.js';

const TINTS = { grass: [0x91, 0xbd, 0x59], foliage: [0x77, 0xab, 0x2f], birch: [0x80, 0xa7, 0x55], spruce: [0x61, 0x99, 0x61], water: [0x3f, 0x76, 0xe4], lily: [0x20, 0x80, 0x30] };

export function rgbaToCanvas(data, w = 16, h = 16, tint = null) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(data);
  if (tint) {
    for (let i = 0; i < w * h; i++) {
      id.data[i * 4] = id.data[i * 4] * tint[0] / 255;
      id.data[i * 4 + 1] = id.data[i * 4 + 1] * tint[1] / 255;
      id.data[i * 4 + 2] = id.data[i * 4 + 2] * tint[2] / 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

export class IconCache {
  constructor({ objects, blockTexMap, itemTexMap }) {
    this.objects = objects; // ObjectRenderer (for geometry + GL)
    this.blockTexMap = blockTexMap;
    this.itemTexMap = itemTexMap;
    this.icons = new Map();
    this.sprites = new Map();
    this.fire = null;
    this.size = 0;
  }

  sprite(name) {
    let c = this.sprites.get(name);
    if (c) return c;
    const d = this.itemTexMap.get(name);
    if (!d) return null;
    c = rgbaToCanvas(d);
    this.sprites.set(name, c);
    return c;
  }

  fireFrame(i) {
    if (!this.fire) {
      const frames = this.blockTexMap.get('fire_0');
      this.fire = frames ? frames.map((f) => rgbaToCanvas(f)) : [];
    }
    return this.fire[i % Math.max(1, this.fire.length)];
  }

  portalFrame(i) {
    if (!this.portal) {
      const frames = this.blockTexMap.get('nether_portal');
      this.portal = frames ? frames.map((f) => rgbaToCanvas(f)) : [];
    }
    return this.portal[i % Math.max(1, this.portal.length)];
  }

  get(id) {
    let c = this.icons.get(id);
    if (c) return c;
    const it = ItemById[id];
    if (!it) return null;
    if (it.icon.kind === 'sprite') {
      const src = it.icon.atlas === 'block' ? this.blockTexMap.get(it.icon.tex)?.[0] : this.itemTexMap.get(it.icon.tex);
      if (!src) return null;
      c = rgbaToCanvas(src, 16, 16, it.icon.tint ? TINTS[it.icon.tint] : null);
      this.icons.set(id, c);
      return c;
    }
    return null; // block icons are rendered in batch by renderBlockIcons
  }

  // Render all block-item icons at the given pixel size into canvases.
  renderBlockIcons(size) {
    if (size === this.size) return;
    this.size = size;
    const obj = this.objects;
    const gl = obj.gl;
    const ids = ItemById.filter((it) => it && it.icon.kind === 'block').map((it) => it.id);
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    const W = cols * size, H = rows * size;
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // orthographic: each icon cell is 16 units
    const proj = mat4.ortho(mat4.create(), 0, cols * 16, rows * 16, 0, -100, 100);
    const batch = obj.blockBatch;
    batch.reset();
    ids.forEach((id, k) => {
      const it = ItemById[id];
      const def = BlockById[it.block];
      const cx = (k % cols) * 16 + 8, cy = Math.floor(k / cols) * 16 + 8;
      const pose = obj.pose;
      pose.m = mat4.identity(mat4.create());
      pose.t(cx, cy, 0);
      pose.s(16, -16, 16);
      // vanilla block gui transform: rotation [30, 225, 0], scale 0.625
      pose.rx(30); pose.ry(225); pose.s(0.625);
      if (def.shape === 'fence') { pose.s(1); }
      const geo = obj.blockGeometry(def.id, def.shape === 'stairs' ? 1 : 0);
      for (const t of geo) {
        const [x, y, z, u, v, l, nx, ny, nz, tint] = t;
        const p = pose.apply(x - 0.5, y - 0.5, z - 0.5);
        // view-space normal (y flipped by the -16 scale)
        const n = pose.applyN(nx, ny, nz);
        const sh = -n[1] > 0.5 ? 1.0 : n[0] < 0 ? 0.8 : 0.6;
        const tc = tint ?? [1, 1, 1];
        batch.push(p[0], p[1], p[2], u, v, l, tc[0] * sh, tc[1] * sh, tc[2] * sh, 1, 1, 1, 0, 0);
      }
    });
    const lm = obj.r.lightmap;
    const env = { fogColor: [0, 0, 0], fogStart: 1e5, fogEnd: 2e5 };
    const p = obj.prog.use();
    gl.uniformMatrix4fv(p.u.u_viewProj, false, proj);
    gl.uniform3fv(p.u.u_fogColor, env.fogColor);
    gl.uniform2f(p.u.u_fog, env.fogStart, env.fogEnd);
    gl.uniform1f(p.u.u_alphaCut, 0.1);
    gl.uniform1f(p.u.u_fullbright, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lm.tex); gl.uniform1i(p.u.u_lightmap, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, obj.r.textures.texture); gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.bindVertexArray(obj.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n * 14), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, batch.n);
    gl.bindVertexArray(null);
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex); gl.deleteRenderbuffer(depth);
    gl.uniform1f(p.u.u_fullbright, 0);
    batch.reset();
    // split into canvases (flip vertically: GL origin is bottom-left)
    ids.forEach((id, k) => {
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      const x0 = (k % cols) * size, y0 = Math.floor(k / cols) * size;
      for (let y = 0; y < size; y++) {
        const srcRow = H - 1 - (y0 + y);
        const s = (srcRow * W + x0) * 4;
        img.data.set(pixels.subarray(s, s + size * 4), y * size * 4);
      }
      ctx.putImageData(img, 0, 0);
      this.icons.set(id, c);
    });
  }
}
