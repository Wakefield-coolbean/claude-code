// Packs all 16x16 block textures (and animation frames) into one TEXTURE_2D_ARRAY.
const SPEEDS = { water_still: 0, water_flow: 0, lava_still: 1, lava_flow: 1, fire_0: 2, fire_1: 2 };

export class BlockTextureArray {
  constructor(gl, texMap) {
    this.gl = gl;
    this.entries = new Map(); // name -> { layer, frames, anim }
    this.images = new Map();  // name -> first frame RGBA (for CPU use: particles, icons)
    let layer = 0;
    const list = [];
    for (const [name, frames] of texMap) {
      const n = Math.min(64, frames.length);
      const speed = SPEEDS[name] ?? (n > 1 ? 0 : 0);
      const anim = n > 1 ? ((n - 1) & 63) | (speed << 6) : 0;
      this.entries.set(name, { layer, frames: n, anim });
      this.images.set(name, frames[0]);
      for (let i = 0; i < n; i++) list.push(frames[i]);
      layer += n;
    }
    // missing texture layer
    const missing = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const m = (x < 8) !== (y < 8);
      missing.set(m ? [248, 0, 248, 255] : [0, 0, 0, 255], (y * 16 + x) * 4);
    }
    this.missing = { layer, frames: 1, anim: 0 };
    list.push(missing);
    layer++;
    this.layerCount = layer;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const levels = 5; // 16,8,4,2,1
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, 16, 16, layer);
    // upload each mip level computed on the CPU (alpha-aware downsampling keeps cutouts looking right)
    for (let lvl = 0; lvl < levels; lvl++) {
      const size = 16 >> lvl;
      const all = new Uint8Array(size * size * 4 * layer);
      list.forEach((img, i) => {
        const m = mip(padTransparent(img), 16, lvl);
        all.set(m, i * size * size * 4);
      });
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lvl, 0, 0, 0, size, size, layer, gl.RGBA, gl.UNSIGNED_BYTE, all);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
    this.texture = tex;
  }

  get(name) { return this.entries.get(name) ?? this.missing; }
  has(name) { return this.entries.has(name); }
  image(name) { return this.images.get(name); }
}

// Fill RGB of fully transparent pixels with neighbouring colours so mipmaps don't get dark fringes.
function padTransparent(src) {
  const out = new Uint8ClampedArray(src);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const prev = new Uint8ClampedArray(out);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      if (prev[i + 3] !== 0 || (prev[i] | prev[i + 1] | prev[i + 2]) !== 0 && pass > 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (x + dx) & 15, ny = (y + dy) & 15;
        const j = (ny * 16 + nx) * 4;
        if (prev[j + 3] > 0 || (pass > 0 && (prev[j] | prev[j + 1] | prev[j + 2]))) { r += prev[j]; g += prev[j + 1]; b += prev[j + 2]; n++; }
      }
      if (n) { out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

function mip(src, size, level) {
  let cur = src, s = size;
  for (let l = 0; l < level; l++) {
    const ns = s >> 1;
    const next = new Uint8ClampedArray(ns * ns * 4);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 2 + dy) * s + x * 2 + dx) * 4;
        const w = cur[i + 3] / 255 + 0.001;
        r += cur[i] * w; g += cur[i + 1] * w; b += cur[i + 2] * w; a += cur[i + 3]; wsum += w;
      }
      const o = (y * ns + x) * 4;
      next[o] = r / wsum; next[o + 1] = g / wsum; next[o + 2] = b / wsum;
      // keep cutout coverage: push alpha toward 0/255
      const av = a / 4;
      next[o + 3] = av;
    }
    cur = next; s = ns;
  }
  return cur;
}
