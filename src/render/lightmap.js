// 16x16 light texture (sky x block) recomputed every frame, modelled after Minecraft's LightTexture.
export class Lightmap {
  constructor(gl) {
    this.gl = gl;
    this.data = new Uint8Array(16 * 16 * 4);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.flicker = 0;
    this.flickerTarget = 0;
  }

  static brightness(level) {
    const f = level / 15;
    return f / (4 - 3 * f);
  }

  // skyBrightness: 0.2..1 (Minecraft getSkyDarken result), gamma 0..1, nightVision 0..1
  update({ skyBrightness, gamma = 0.5, nightVision = 0, lightningFlash = false, underwaterBoost = 0 }) {
    // torch flicker (random walk like vanilla)
    this.flickerTarget += (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1;
    this.flickerTarget *= 0.9;
    this.flicker += (this.flickerTarget - this.flicker);
    const skyFactor = lightningFlash ? 1 : skyBrightness;
    const skyTint = [
      1 + (skyBrightness - 1) * 0.35,
      1 + (skyBrightness - 1) * 0.35,
      1,
    ];
    const blockFlicker = this.flicker + 1.5;
    const d = this.data;
    for (let sky = 0; sky < 16; sky++) {
      for (let blk = 0; blk < 16; blk++) {
        const skyB = Lightmap.brightness(sky) * skyFactor;
        const blockB = Lightmap.brightness(blk) * blockFlicker;
        const g = blockB * ((blockB * 0.6 + 0.4) * 0.6 + 0.4);
        const b = blockB * (blockB * blockB * 0.6 + 0.4);
        let r = blockB + skyTint[0] * skyB;
        let gg = g + skyTint[1] * skyB;
        let bb = b + skyTint[2] * skyB;
        r = r + (0.75 - r) * 0.04; gg = gg + (0.75 - gg) * 0.04; bb = bb + (0.75 - bb) * 0.04;
        if (underwaterBoost > 0) {
          const m = Math.max(r, gg, bb);
          if (m < 1) { const k = 1 / m; r += (r * k - r) * underwaterBoost * 0.3; gg += (gg * k - gg) * underwaterBoost * 0.3; bb += (bb * k - bb) * underwaterBoost * 0.3; }
        }
        if (nightVision > 0) {
          const m = Math.max(r, gg, bb);
          if (m < 1) { const k = 1 / m; r += (r * k - r) * nightVision; gg += (gg * k - gg) * nightVision; bb += (bb * k - bb) * nightVision; }
        }
        r = clamp01(r); gg = clamp01(gg); bb = clamp01(bb);
        const ng = (x) => 1 - Math.pow(1 - x, 4);
        r = r + (ng(r) - r) * gamma; gg = gg + (ng(gg) - gg) * gamma; bb = bb + (ng(bb) - bb) * gamma;
        r = r + (0.75 - r) * 0.04; gg = gg + (0.75 - gg) * 0.04; bb = bb + (0.75 - bb) * 0.04;
        const o = (sky * 16 + blk) * 4;
        d[o] = clamp01(r) * 255; d[o + 1] = clamp01(gg) * 255; d[o + 2] = clamp01(bb) * 255; d[o + 3] = 255;
      }
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, d);
  }

  // CPU lookup (0..1 rgb) for entity rendering
  sample(sky, blk) {
    const s = Math.max(0, Math.min(15, Math.round(sky))), b = Math.max(0, Math.min(15, Math.round(blk)));
    const o = (s * 16 + b) * 4;
    return [this.data[o] / 255, this.data[o + 1] / 255, this.data[o + 2] / 255];
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
