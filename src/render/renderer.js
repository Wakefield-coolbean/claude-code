import { Program, createQuadIndexBuffer } from './gl.js';
import { Mesher, VERT_BYTES } from './mesher.js';
import { Lightmap } from './lightmap.js';
import { SkyRenderer } from './sky.js';
import { mat4, frustumPlanes, aabbInFrustum, clamp, hexToRgb } from '../util/math.js';
import { MIN_Y, SECTION_COUNT, ID_MASK } from '../constants.js';
import { BlockById } from '../registry/blocks.js';
import { getSelectionBoxes } from '../registry/shapes.js';

const CHUNK_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_layer;
layout(location=3) in vec4 a_light;
layout(location=4) in vec4 a_tint;
uniform mat4 u_viewProj;
uniform vec3 u_origin;
uniform float u_timeSec;
out vec3 v_uvl;
out vec2 v_light;
out float v_shade;
out vec3 v_tint;
out float v_dist;
void main(){
  vec3 p = a_pos / 2048.0 - 8.0 + u_origin;
  gl_Position = u_viewProj * vec4(p, 1.0);
  float layer = a_layer;
  float anim = floor(a_light.w * 255.0 + 0.5);
  if (anim > 0.5) {
    float frames = mod(anim, 64.0) + 1.0;
    float sp = floor(anim / 64.0);
    float fps = sp < 0.5 ? 10.0 : (sp < 1.5 ? 6.6667 : (sp < 2.5 ? 20.0 : 5.0));
    layer += mod(floor(u_timeSec * fps), frames);
  }
  v_uvl = vec3(a_uv / 4096.0, layer);
  v_light = a_light.xy;
  v_shade = a_light.z;
  v_tint = a_tint.rgb;
  v_dist = length(p);
}`;

const CHUNK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 v_uvl;
in vec2 v_light;
in float v_shade;
in vec3 v_tint;
in float v_dist;
uniform sampler2DArray u_tex;
uniform sampler2D u_lightmap;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_alphaCut;
out vec4 o;
void main(){
  vec4 c = texture(u_tex, v_uvl);
  if (c.a < u_alphaCut) discard;
  vec3 lm = texture(u_lightmap, vec2(v_light.y, v_light.x) * (15.0/16.0) + 0.5/16.0).rgb;
  c.rgb *= v_tint * v_shade * lm;
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  c.rgb = mix(c.rgb, u_fogColor, f);
  o = c;
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_viewProj;
void main(){ gl_Position = u_viewProj * vec4(a_pos, 1.0); }`;
const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main(){ o = u_color; }`;

const CRACK_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
uniform mat4 u_viewProj;
out vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = u_viewProj * vec4(a_pos, 1.0); }`;
const CRACK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
uniform sampler2DArray u_tex;
uniform float u_layer;
out vec4 o;
void main(){
  vec4 c = texture(u_tex, vec3(v_uv, u_layer));
  if (c.a < 0.1) discard;
  o = vec4(c.rgb, c.a * 0.75);
}`;

export class Renderer {
  constructor(canvas, blockTextures, envTextures) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    // BlockTextureArray, or a factory (gl) => BlockTextureArray
    this.textures = typeof blockTextures === 'function' ? blockTextures(gl) : blockTextures;
    this.mesher = new Mesher(this.textures);
    this.lightmap = new Lightmap(gl);
    this.sky = new SkyRenderer(gl, envTextures);
    this.chunkProg = new Program(gl, CHUNK_VS, CHUNK_FS, 'chunk');
    this.lineProg = new Program(gl, LINE_VS, LINE_FS, 'line');
    this.crackProg = new Program(gl, CRACK_VS, CRACK_FS, 'crack');
    this.quadIndex = createQuadIndexBuffer(gl, 1 << 17);
    this.proj = mat4.create();
    this.view = mat4.create();
    this.viewProj = mat4.create();
    this.frustum = new Float32Array(24);
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    this.crackVao = gl.createVertexArray();
    this.crackBuf = gl.createBuffer();
    gl.bindVertexArray(this.crackVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.crackBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    this.stats = { sections: 0, drawn: 0, meshTime: 0, meshed: 0, triangles: 0 };
    this.meshQueue = [];
    this.extraRenderers = []; // entity/particle/hand renderers: { render(ctx) }
    this.width = 1; this.height = 1;
  }

  resize(w, h) {
    this.canvas.width = w; this.canvas.height = h;
    this.width = w; this.height = h;
  }

  // ---------- mesh management ----------
  uploadSection(chunk, si, data) {
    const gl = this.gl;
    let m = chunk.meshes[si];
    if (!m) m = chunk.meshes[si] = { solid: null, trans: null };
    m.solid = this.uploadLayer(m.solid, data ? data.solid : null, data ? data.solidCount : 0);
    m.trans = this.uploadLayer(m.trans, data ? data.trans : null, data ? data.transCount : 0);
    if (!m.solid && !m.trans) chunk.meshes[si] = null;
    void gl;
  }

  uploadLayer(layer, bytes, count) {
    const gl = this.gl;
    if (!count) {
      if (layer) { gl.deleteBuffer(layer.vbo); gl.deleteVertexArray(layer.vao); }
      return null;
    }
    if (!layer) {
      layer = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0, cap: 0 };
      gl.bindVertexArray(layer.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
      gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, VERT_BYTES, 0);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, false, VERT_BYTES, 6);
      gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, false, VERT_BYTES, 10);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, VERT_BYTES, 12);
      gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, VERT_BYTES, 16);
      for (let i = 0; i < 5; i++) gl.enableVertexAttribArray(i);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    layer.count = count;
    layer.data = count <= 4096 * 4 ? bytes : null; // keep small translucent meshes for re-sorting (unused)
    return layer;
  }

  freeChunk(chunk) {
    for (let si = 0; si < SECTION_COUNT; si++) {
      if (chunk.meshes[si]) this.uploadSection(chunk, si, null);
    }
  }

  // Remesh dirty sections of meshable chunks, closest first, within a time budget.
  updateMeshes(world, camPos, budgetMs, renderDistance) {
    const t0 = performance.now();
    const pcx = Math.floor(camPos[0]) >> 4, pcz = Math.floor(camPos[2]) >> 4;
    const psi = (Math.floor(camPos[1]) - MIN_Y) >> 4;
    const list = [];
    for (const c of world.dirtyChunks) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > renderDistance) continue;
      if (!world.isMeshable(c)) continue;
      list.push([d, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let count = 0;
    for (const [, c] of list) {
      const sections = [...c.dirty].sort((a, b) => Math.abs(a - psi) - Math.abs(b - psi));
      for (const si of sections) {
        if (count > 0 && performance.now() - t0 > budgetMs) return count;
        const data = this.mesher.mesh(world, c, si);
        this.uploadSection(c, si, data);
        c.dirty.delete(si);
        count++;
      }
      if (c.dirty.size === 0) world.dirtyChunks.delete(c);
    }
    this.stats.meshTime = performance.now() - t0;
    return count;
  }

  // ---------- environment ----------
  computeEnv(world, cam, opts) {
    if (world.dimension === 'nether') return this.computeNetherEnv(world, cam, opts);
    const angle = world.celestialAngle(opts.partial);
    const biome = world.getBiomeDef(Math.floor(cam[0]), Math.floor(cam[2]));
    // day brightness
    let f = Math.cos(angle * Math.PI * 2) * 2 + 0.5;
    f = clamp(f, 0, 1);
    const skyBase = hexToRgb(biome.sky ?? 0x78a7ff);
    let sky = [skyBase[0] * f, skyBase[1] * f, skyBase[2] * f];
    const rain = world.rain, thunder = world.thunder;
    if (rain > 0) {
      const lum = (sky[0] * 0.3 + sky[1] * 0.59 + sky[2] * 0.11) * 0.6;
      const k = 1 - rain * 0.75;
      sky = sky.map((c) => c * k + lum * (1 - k));
    }
    if (thunder > 0) {
      const lum = (sky[0] * 0.3 + sky[1] * 0.59 + sky[2] * 0.11) * 0.2;
      const k = 1 - thunder * 0.75;
      sky = sky.map((c) => c * k + lum * (1 - k));
    }
    let fog = [0.753 * (f * 0.94 + 0.06), 0.847 * (f * 0.94 + 0.06), 1.0 * (f * 0.91 + 0.09)];
    // sunrise colour
    let sunrise = [0, 0, 0, 0];
    const g = Math.cos(angle * Math.PI * 2);
    if (g >= -0.4 && g <= 0.4) {
      const h = g / 0.4 * 0.5 + 0.5;
      let j = 1 - (1 - Math.sin(h * Math.PI)) * 0.99;
      j *= j;
      sunrise = [h * 0.3 + 0.7, h * h * 0.7 + 0.2, 0.2, j];
    }
    const sunDir = [-Math.sin(angle * Math.PI * 2), Math.cos(angle * Math.PI * 2), 0];
    // blend fog towards sunrise colour when looking at the sun
    if (sunrise[3] > 0 && opts.lookDir) {
      const sd = Math.sin(angle * Math.PI * 2) > 0 ? -1 : 1;
      let dot = opts.lookDir[0] * sd;
      if (dot < 0) dot = 0;
      if (dot > 0) {
        const k = dot * sunrise[3];
        fog = fog.map((c, i) => c * (1 - k) + sunrise[i] * k);
      }
    }
    const rd = opts.renderDistance;
    const mixF = 1 - Math.pow(0.25 + 0.75 * rd / 32, 0.25);
    fog = fog.map((c, i) => c + (sky[i] - c) * mixF);
    if (rain > 0) { const k = 1 - rain * 0.5; fog = fog.map((c) => c * k); }
    if (thunder > 0) { const k = 1 - thunder * 0.5; fog = fog.map((c) => c * k); }
    // underground darkening of the fog (void fog / caves): scale by eye sky light
    const skyL = opts.eyeSkyLight ?? 15;
    const caveF = clamp((skyL) / 15, 0, 1);
    const caveMix = 0.15 + 0.85 * caveF;
    fog = fog.map((c) => c * caveMix);
    let fogStart, fogEnd;
    const dist = rd * 16;
    fogStart = dist - clamp(dist / 10, 4, 64);
    fogEnd = dist;
    let underwater = false, inLava = false;
    if (opts.eyeFluid === 'water') {
      underwater = true;
      const wc = hexToRgb(biome.water ?? 0x3f76e4);
      const bright = Math.max(0.25, f * caveF);
      fog = [wc[0] * 0.25 * bright, wc[1] * 0.35 * bright, wc[2] * 0.55 * bright];
      fogStart = -8; fogEnd = 96 * (opts.waterVision ?? 0.6);
    } else if (opts.eyeFluid === 'lava') {
      inLava = true;
      fog = [0.6, 0.1, 0.0];
      fogStart = 0.25; fogEnd = 1.0;
    }
    if (opts.blindness) { fog = [0, 0, 0]; fogStart = 0; fogEnd = 5; }
    // star brightness
    let sb = 1 - (Math.cos(angle * Math.PI * 2) * 2 + 0.25);
    sb = clamp(sb, 0, 1);
    sb = sb * sb * 0.5;
    // cloud colour
    let cf = clamp(Math.cos(angle * Math.PI * 2) * 2 + 0.5, 0, 1);
    let cloud = [cf * 0.9 + 0.1, cf * 0.9 + 0.1, cf * 0.85 + 0.15];
    if (rain > 0) { const lum = (cloud[0] * 0.3 + cloud[1] * 0.59 + cloud[2] * 0.11) * 0.6; const k = 1 - rain * 0.95; cloud = cloud.map((c) => c * k + lum * (1 - k)); }
    // sky brightness factor for lightmap (Minecraft getSkyDarken)
    let sd = 1 - (Math.cos(angle * Math.PI * 2) * 2 + 0.2);
    sd = clamp(sd, 0, 1);
    sd = 1 - sd;
    sd *= 1 - rain * 5 / 16;
    sd *= 1 - thunder * 5 / 16;
    const skyBrightness = sd * 0.8 + 0.2;
    const horizonDark = cam[1] < 63 ? 0.2 : 1.0;
    return {
      skyColor: sky, fogColor: fog, sunrise, sunDir, celestialAngle: angle, starBrightness: sb,
      cloudColor: cloud, skyBrightness, fogStart, fogEnd, underwater, inLava, rain, moonPhase: world.moonPhase(),
      horizonDark, cloudsOff: opts.cloudsOff,
    };
  }

  // Nether: no sky, sun or clouds; thick biome-coloured fog close to the camera.
  computeNetherEnv(world, cam, opts) {
    const biome = world.getBiomeDef(Math.floor(cam[0]), Math.floor(cam[2]));
    let fog = hexToRgb(biome.fog ?? 0x330808);
    const target = this.netherFog ?? fog.slice();
    // fade between biome fog colours like vanilla's fog colour interpolation
    for (let i = 0; i < 3; i++) target[i] += (fog[i] - target[i]) * 0.02;
    this.netherFog = target;
    fog = target.slice();
    const rd = opts.renderDistance;
    let fogStart = rd * 16 * 0.05, fogEnd = Math.min(rd * 16, 192) * 0.5;
    let underwater = false, inLava = false;
    if (opts.eyeFluid === 'lava') { inLava = true; fog = [0.6, 0.1, 0.0]; fogStart = 0.25; fogEnd = 1.0; }
    else if (opts.eyeFluid === 'water') { underwater = true; fog = [0.05, 0.07, 0.2]; fogStart = -8; fogEnd = 48; }
    if (opts.blindness) { fog = [0, 0, 0]; fogStart = 0; fogEnd = 5; }
    return {
      skyColor: fog, fogColor: fog, sunrise: [0, 0, 0, 0], sunDir: [0, 1, 0], celestialAngle: 0, starBrightness: 0,
      cloudColor: [0, 0, 0], skyBrightness: 0, fogStart, fogEnd, underwater, inLava, rain: 0, moonPhase: 0,
      horizonDark: 1, cloudsOff: true, noSky: true, nether: true,
    };
  }

  // ---------- frame ----------
  // cam: { pos:[x,y,z] (eye), yaw, pitch, roll, fov, bob:{x,y,rx,rz} }
  render(world, cam, opts) {
    const gl = this.gl;
    const w = this.width, h = this.height;
    gl.viewport(0, 0, w, h);
    const env = this.computeEnv(world, cam.pos, opts);
    this.env = env;
    this.lightmap.update({
      skyBrightness: env.skyBrightness, gamma: opts.gamma ?? 0.5, nightVision: opts.nightVision ?? 0,
      lightningFlash: opts.lightningFlash, underwaterBoost: env.underwater ? 1 : 0,
      ambient: env.nether ? 0.1 : 0, constantAmbient: !!env.nether,
    });
    // matrices (camera-relative)
    const far = Math.max(256, opts.renderDistance * 16 * 2 + 64);
    mat4.perspective(this.proj, cam.fov * Math.PI / 180, w / h, 0.05, far);
    const v = mat4.identity(this.view);
    if (cam.bob) {
      mat4.translate(v, v, cam.bob.x, cam.bob.y, 0);
      mat4.rotateZ(v, v, cam.bob.rz);
      mat4.rotateX(v, v, cam.bob.rx);
    }
    if (cam.roll) mat4.rotateZ(v, v, cam.roll);
    mat4.rotateX(v, v, -cam.pitch);
    mat4.rotateY(v, v, -cam.yaw);
    if (cam.thirdPerson) mat4.translate(v, v, -cam.tpOffset[0], -cam.tpOffset[1], -cam.tpOffset[2]);
    mat4.multiply(this.viewProj, this.proj, v);
    frustumPlanes(this.viewProj, this.frustum);

    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    // sky uses rotation-only view (no bobbing translation)
    const rotOnly = mat4.identity(mat4.create());
    if (cam.roll) mat4.rotateZ(rotOnly, rotOnly, cam.roll);
    mat4.rotateX(rotOnly, rotOnly, -cam.pitch);
    mat4.rotateY(rotOnly, rotOnly, -cam.yaw);
    this.sky.drawSky(env, rotOnly, this.proj);

    // terrain
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const prog = this.chunkProg.use();
    const u = prog.u;
    gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
    gl.uniform1f(u.u_timeSec, opts.timeSec);
    gl.uniform3fv(u.u_fogColor, env.fogColor);
    gl.uniform2f(u.u_fog, env.fogStart, env.fogEnd);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.texture);
    gl.uniform1i(u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lightmap.tex);
    gl.uniform1i(u.u_lightmap, 1);

    const camX = cam.pos[0], camY = cam.pos[1], camZ = cam.pos[2];
    const eyePos = cam.thirdPerson ? cam.eyeWorld : cam.pos;
    const pcx = Math.floor(eyePos[0]) >> 4, pcz = Math.floor(eyePos[2]) >> 4;
    const rd = opts.renderDistance;
    const visible = [];
    let drawnTris = 0;
    for (const c of world.chunks.values()) {
      if (Math.abs(c.cx - pcx) > rd || Math.abs(c.cz - pcz) > rd) continue;
      const ox = (c.cx << 4) - camX, oz = (c.cz << 4) - camZ;
      for (let si = 0; si < SECTION_COUNT; si++) {
        const m = c.meshes[si];
        if (!m) continue;
        const oy = MIN_Y + si * 16 - camY;
        if (!aabbInFrustum(this.frustum, ox, oy, oz, ox + 16, oy + 16, oz + 16)) continue;
        const dx = ox + 8, dy = oy + 8, dz = oz + 8;
        visible.push({ m, ox, oy, oz, d: dx * dx + dy * dy + dz * dz });
      }
    }
    visible.sort((a, b) => a.d - b.d);
    gl.uniform1f(u.u_alphaCut, 0.5);
    for (const s of visible) {
      if (!s.m.solid) continue;
      gl.uniform3f(u.u_origin, s.ox, s.oy, s.oz);
      gl.bindVertexArray(s.m.solid.vao);
      gl.drawElements(gl.TRIANGLES, (s.m.solid.count / 4) * 6, gl.UNSIGNED_INT, 0);
      drawnTris += s.m.solid.count / 2;
    }
    this.stats.drawn = visible.length;
    this.visibleSections = visible;

    // entities, block entities, particles (opaque) are drawn by extra renderers
    const ctx = { gl, viewProj: this.viewProj, view: v, proj: this.proj, cam, camPos: cam.pos, env, lightmap: this.lightmap, world, opts, renderer: this, frustum: this.frustum };
    for (const r of this.extraRenderers) if (r.renderOpaque) r.renderOpaque(ctx);

    // selection outline & breaking cracks
    if (opts.selection) this.drawSelection(world, opts.selection, cam.pos, opts.breakStage ?? -1);

    // translucent terrain (back to front)
    prog.use();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lightmap.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(u.u_alphaCut, 0.004);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const s = visible[i];
      if (!s.m.trans) continue;
      gl.uniform3f(u.u_origin, s.ox, s.oy, s.oz);
      gl.bindVertexArray(s.m.trans.vao);
      gl.drawElements(gl.TRIANGLES, (s.m.trans.count / 4) * 6, gl.UNSIGNED_INT, 0);
      drawnTris += s.m.trans.count / 2;
    }
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    this.stats.triangles = drawnTris;

    // clouds
    gl.disable(gl.CULL_FACE);
    if (!env.underwater) this.sky.drawClouds(this.viewProj, cam.pos, opts.worldTime, env, rd);

    for (const r of this.extraRenderers) if (r.renderTranslucent) r.renderTranslucent(ctx);
    gl.bindVertexArray(null);
    // first person hand etc. (drawn over the world with a cleared depth buffer)
    for (const r of this.extraRenderers) if (r.renderOverlay) r.renderOverlay(ctx);
  }

  drawSelection(world, sel, camPos, stage) {
    const gl = this.gl;
    const v = world.getBlock(sel.x, sel.y, sel.z);
    const def = BlockById[v & ID_MASK];
    const nb = (dx, dy, dz) => world.getBlock(sel.x + dx, sel.y + dy, sel.z + dz);
    const boxes = getSelectionBoxes(def, v >>> 12, nb);
    if (!boxes.length) return;
    const ox = sel.x - camPos[0], oy = sel.y - camPos[1], oz = sel.z - camPos[2];
    // outline
    const e = 0.002;
    const lines = [];
    for (const b of boxes) {
      const x0 = ox + b[0] - e, y0 = oy + b[1] - e, z0 = oz + b[2] - e, x1 = ox + b[3] + e, y1 = oy + b[4] + e, z1 = oz + b[5] + e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) lines.push(...c[a], ...c[bb]);
    }
    this.lineProg.use();
    gl.uniformMatrix4fv(this.lineProg.u.u_viewProj, false, this.viewProj);
    gl.uniform4f(this.lineProg.u.u_color, 0, 0, 0, 0.4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);

    if (stage >= 0) {
      const verts = [];
      const eps = 0.003;
      for (const b of boxes) {
        const x0 = ox + b[0] - eps, y0 = oy + b[1] - eps, z0 = oz + b[2] - eps, x1 = ox + b[3] + eps, y1 = oy + b[4] + eps, z1 = oz + b[5] + eps;
        const faces = [
          [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
          [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]],
          [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
          [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
          [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]],
          [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]],
        ];
        const uvs = [[0, 0], [0, 1], [1, 1], [1, 0]];
        for (const f of faces) for (const k of [0, 1, 2, 0, 2, 3]) verts.push(...f[k], ...uvs[k]);
      }
      this.crackProg.use();
      gl.uniformMatrix4fv(this.crackProg.u.u_viewProj, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.texture);
      gl.uniform1i(this.crackProg.u.u_tex, 0);
      gl.uniform1f(this.crackProg.u.u_layer, this.textures.get(`destroy_stage_${Math.min(9, stage)}`).layer);
      gl.bindVertexArray(this.crackVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.crackBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / 5);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
