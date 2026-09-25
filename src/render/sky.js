import { Program } from './gl.js';
import { mat4 } from '../util/math.js';
import { mulberry32 } from '../util/rng.js';

const SKY_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_ndc;
void main(){ v_ndc = a_pos; gl_Position = vec4(a_pos, 0.9999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invViewProj;
uniform vec3 u_skyColor;
uniform vec3 u_fogColor;
uniform vec4 u_sunrise;     // rgb, alpha
uniform vec3 u_sunDir;
uniform float u_horizonDark;
out vec4 o;
void main(){
  vec4 p = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  float e = dir.y;
  float t = smoothstep(-0.02, 0.42, e);
  vec3 col = mix(u_fogColor, u_skyColor, t);
  // sunrise / sunset glow near the horizon in the sun's direction
  if (u_sunrise.a > 0.0) {
    vec2 hs = normalize(u_sunDir.xz + vec2(1e-5));
    vec2 hd = normalize(dir.xz + vec2(1e-5));
    float facing = max(0.0, dot(hs, hd));
    float g = pow(facing, 4.0) * (1.0 - smoothstep(0.0, 0.45, abs(e - 0.02))) * u_sunrise.a;
    col = mix(col, u_sunrise.rgb, clamp(g, 0.0, 1.0));
  }
  // below the horizon the void darkens (visible when high up)
  if (e < 0.0) col = mix(col, col * u_horizonDark, smoothstep(0.0, -0.3, e));
  o = vec4(col, 1.0);
}`;

const CELESTIAL_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
uniform mat4 u_mvp;
out vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = u_mvp * vec4(a_pos, 1.0); gl_Position.z = gl_Position.w * 0.9998; }`;

const CELESTIAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform int u_useTex;
out vec4 o;
void main(){
  vec4 c = u_useTex == 1 ? texture(u_tex, v_uv) : vec4(1.0);
  o = vec4(c.rgb * u_color.rgb * u_color.a, 1.0);
}`;

const CLOUD_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in float a_shade;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
out float v_shade;
out float v_dist;
void main(){
  vec3 p = a_pos + u_offset;
  v_shade = a_shade;
  v_dist = length(p.xz);
  gl_Position = u_viewProj * vec4(p, 1.0);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
in float v_shade;
in float v_dist;
uniform vec3 u_color;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
out vec4 o;
void main(){
  vec3 c = u_color * v_shade;
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  float a = 0.8 * (1.0 - f);
  if (a <= 0.01) discard;
  o = vec4(mix(c, u_fogColor, f * 0.5), a);
}`;

export const CLOUD_HEIGHT = 192.33;
const CLOUD_CELL = 12;
const CLOUD_THICK = 4;

export class SkyRenderer {
  constructor(gl, envTextures) {
    this.gl = gl;
    this.skyProg = new Program(gl, SKY_VS, SKY_FS, 'sky');
    this.celProg = new Program(gl, CELESTIAL_VS, CELESTIAL_FS, 'celestial');
    this.cloudProg = new Program(gl, CLOUD_VS, CLOUD_FS, 'clouds');
    // fullscreen triangle
    this.fsVao = gl.createVertexArray();
    gl.bindVertexArray(this.fsVao);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // unit quad for sun / moon (in the XY plane at z = -dist, facing +Z)
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(6 * 5), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    this.sunTex = this.upload(envTextures?.get('sun'));
    this.moonTex = this.upload(envTextures?.get('moon_phases'));
    this.buildStars();
    this.buildClouds(envTextures?.get('clouds'));
    gl.bindVertexArray(null);
    this.mvp = mat4.create();
    this.tmp = mat4.create();
  }

  upload(img) {
    if (!img) return null;
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.w, img.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  buildStars() {
    const gl = this.gl;
    const rand = mulberry32(10842);
    const verts = [];
    for (let i = 0; i < 1500; i++) {
      let x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
      const size = 0.15 + rand() * 0.1;
      const d = x * x + y * y + z * z;
      if (d >= 1 || d <= 0.01) continue;
      const l = 1 / Math.sqrt(d);
      x *= l; y *= l; z *= l;
      // tangent basis around the star direction
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(y) > 0.9) { ux = 1; uy = 0; }
      let t1x = y * uz - z * uy, t1y = z * ux - x * uz, t1z = x * uy - y * ux;
      const tl = Math.hypot(t1x, t1y, t1z); t1x /= tl; t1y /= tl; t1z /= tl;
      const t2x = y * t1z - z * t1y, t2y = z * t1x - x * t1z, t2z = x * t1y - y * t1x;
      const rot = rand() * Math.PI * 2;
      const quad = [];
      for (let k = 0; k < 4; k++) {
        const ang = rot + k * Math.PI / 2;
        const a = Math.cos(ang) * size * 1.41, b = Math.sin(ang) * size * 1.41;
        quad.push([x * 100 + (t1x * a + t2x * b) * 100 / 100 * 1, y * 100 + (t1y * a + t2y * b), z * 100 + (t1z * a + t2z * b)]);
      }
      for (const k of [0, 1, 2, 0, 2, 3]) verts.push(...quad[k], 0, 0);
    }
    this.starVao = gl.createVertexArray();
    gl.bindVertexArray(this.starVao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    this.starCount = verts.length / 5;
  }

  buildClouds(img) {
    const gl = this.gl;
    let w = 256, h = 256, data;
    if (img) { w = img.w; h = img.h; data = img.data; }
    else {
      data = new Uint8ClampedArray(w * h * 4);
      const rand = mulberry32(1234);
      for (let i = 0; i < w * h; i++) data[i * 4 + 3] = rand() < 0.3 ? 255 : 0;
    }
    const filled = (x, y) => data[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4 + 3] > 127;
    const v = [];
    const C = CLOUD_CELL, T = CLOUD_THICK;
    const quad = (pts, shade) => { for (const k of [0, 1, 2, 0, 2, 3]) v.push(...pts[k], shade); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      const x0 = x * C, x1 = x0 + C, z0 = y * C, z1 = z0 + C;
      quad([[x0, T, z0], [x0, T, z1], [x1, T, z1], [x1, T, z0]], 1.0);
      quad([[x0, 0, z1], [x0, 0, z0], [x1, 0, z0], [x1, 0, z1]], 0.7);
      if (!filled(x - 1, y)) quad([[x0, T, z0], [x0, 0, z0], [x0, 0, z1], [x0, T, z1]], 0.9);
      if (!filled(x + 1, y)) quad([[x1, T, z1], [x1, 0, z1], [x1, 0, z0], [x1, T, z0]], 0.9);
      if (!filled(x, y - 1)) quad([[x1, T, z0], [x1, 0, z0], [x0, 0, z0], [x0, T, z0]], 0.8);
      if (!filled(x, y + 1)) quad([[x0, T, z1], [x0, 0, z1], [x1, 0, z1], [x1, T, z1]], 0.8);
    }
    this.cloudVao = gl.createVertexArray();
    gl.bindVertexArray(this.cloudVao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    this.cloudCount = v.length / 4;
    this.cloudSize = [w * C, h * C];
  }

  // Draw the sky background. env: computed colours/angles from Renderer.
  drawSky(env, rotOnly, proj) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const vp = mat4.multiply(this.tmp, proj, rotOnly);
    const inv = mat4.invert(mat4.create(), vp);
    this.skyProg.use();
    const u = this.skyProg.u;
    gl.uniformMatrix4fv(u.u_invViewProj, false, inv);
    gl.uniform3fv(u.u_skyColor, env.skyColor);
    gl.uniform3fv(u.u_fogColor, env.fogColor);
    gl.uniform4fv(u.u_sunrise, env.sunrise);
    gl.uniform3fv(u.u_sunDir, env.sunDir);
    gl.uniform1f(u.u_horizonDark, env.horizonDark);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (env.underwater || env.inLava || env.noSky) { gl.bindVertexArray(null); return; }
    // celestial bodies: rotate with the celestial angle around the Z axis (sun rises in the east)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.celProg.use();
    const cu = this.celProg.u;
    const m = mat4.copy(mat4.create(), rotOnly);
    mat4.rotateZ(m, m, env.celestialAngle * Math.PI * 2);
    const mvp = mat4.multiply(this.mvp, proj, m);
    gl.uniformMatrix4fv(cu.u_mvp, false, mvp);
    const rainFade = 1 - env.rain;
    // stars
    if (env.starBrightness > 0) {
      gl.uniform1i(cu.u_useTex, 0);
      const s = env.starBrightness * rainFade;
      gl.uniform4f(cu.u_color, s, s, s, 1);
      gl.bindVertexArray(this.starVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.starCount);
    }
    gl.uniform1i(cu.u_useTex, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(cu.u_tex, 0);
    gl.bindVertexArray(this.quadVao);
    // sun: at +Y in rotated space (noon overhead), MC places it at y=100
    if (this.sunTex) {
      gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
      this.setQuad(30, 100, 0, 0, 1, 1);
      gl.uniform4f(cu.u_color, 1, 1, 1, rainFade);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (this.moonTex) {
      gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
      const phase = env.moonPhase;
      const col = phase % 4, row = Math.floor(phase / 4);
      this.setQuad(20, -100, col / 4, row / 2, (col + 1) / 4, (row + 1) / 2);
      gl.uniform4f(cu.u_color, 1, 1, 1, rainFade);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  setQuad(size, y, u0, v0, u1, v1) {
    const s = size;
    // quad facing the origin at height y (texture upright when viewed from below/above)
    const dir = y > 0 ? 1 : -1;
    const pts = [
      [-s, y, -s * dir, u0, v0], [s, y, -s * dir, u1, v0], [s, y, s * dir, u1, v1],
      [-s, y, -s * dir, u0, v0], [s, y, s * dir, u1, v1], [-s, y, s * dir, u0, v1],
    ];
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pts.flat()));
  }

  // viewProj: camera-relative view-projection. cam: world camera pos. time: ticks (float)
  drawClouds(viewProj, cam, time, env, renderDistance) {
    if (env.cloudsOff) return;
    const gl = this.gl;
    const [W, H] = this.cloudSize;
    const offsetX = time * 0.03;
    // cloud-space position of the camera
    const cxw = cam[0] + offsetX, czw = cam[2] + 3.96;
    const baseX = Math.floor(cxw / W) * W, baseZ = Math.floor(czw / H) * H;
    this.cloudProg.use();
    const u = this.cloudProg.u;
    gl.uniformMatrix4fv(u.u_viewProj, false, viewProj);
    gl.uniform3fv(u.u_color, env.cloudColor);
    gl.uniform3fv(u.u_fogColor, env.fogColor);
    const range = Math.max(96, renderDistance * 16 * 1.6);
    gl.uniform2f(u.u_fog, range * 0.5, range);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(this.cloudVao);
    // first pass depth only (so overlapping faces don't double-blend), second pass colour
    for (const pass of [0, 1]) {
      if (pass === 0) { gl.colorMask(false, false, false, false); gl.depthMask(true); }
      else { gl.colorMask(true, true, true, true); gl.depthFunc(gl.LEQUAL); }
      for (let tx = -1; tx <= 1; tx++) for (let tz = -1; tz <= 1; tz++) {
        const ox = baseX + tx * W, oz = baseZ + tz * H;
        // skip copies entirely outside the cloud range
        const nx = Math.max(ox, Math.min(cxw, ox + W)), nz = Math.max(oz, Math.min(czw, oz + H));
        if (Math.hypot(nx - cxw, nz - czw) > range) continue;
        gl.uniform3f(u.u_offset, ox - offsetX - cam[0], CLOUD_HEIGHT - cam[1], oz - 3.96 - cam[2]);
        gl.drawArrays(gl.TRIANGLES, 0, this.cloudCount);
      }
    }
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
