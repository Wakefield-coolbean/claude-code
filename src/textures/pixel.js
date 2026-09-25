// Tiny pixel-art canvas operating on raw RGBA arrays (works in browsers, workers and Node).
import { mulberry32 } from '../util/rng.js';

export class PixelCanvas {
  constructor(w = 16, h = 16, data = null) {
    this.w = w; this.h = h;
    this.data = data ?? new Uint8ClampedArray(w * h * 4);
  }
  static fromHex(w, h, hex) { const c = new PixelCanvas(w, h); c.fill(hex); return c; }
  clone() { return new PixelCanvas(this.w, this.h, new Uint8ClampedArray(this.data)); }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x, y) { return (y * this.w + x) * 4; }
  // color: [r,g,b,a?] or 0xRRGGBB number or '#rrggbb'
  set(x, y, color, alpha) {
    x |= 0; y |= 0;
    if (!this.inside(x, y)) return;
    const [r, g, b, a] = toRGBA(color, alpha);
    const i = this.idx(x, y);
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = this.idx(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  // alpha-blend a color on top
  blend(x, y, color, alpha = 1) {
    x |= 0; y |= 0;
    if (!this.inside(x, y)) return;
    const [r, g, b, a0] = toRGBA(color);
    const a = (a0 / 255) * alpha;
    const i = this.idx(x, y);
    const d = this.data;
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (r * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  fill(color) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, color); return this; }
  rect(x0, y0, w, h, color) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, color); return this; }
  line(x0, y0, x1, y1, color) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  // Draw a pixel map: rows of chars, palette maps char -> color (missing/'.' = skip)
  pattern(x0, y0, rows, palette) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = palette[row[x]];
        if (c != null) this.set(x0 + x, y0 + y, c);
      }
    });
    return this;
  }
  // multiply each pixel's rgb by factor (for shading)
  shade(x, y, f) {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    this.data[i] *= f; this.data[i + 1] *= f; this.data[i + 2] *= f;
  }
  map(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = this.idx(x, y);
      const out = fn(x, y, [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]);
      if (out) { this.data[i] = out[0]; this.data[i + 1] = out[1]; this.data[i + 2] = out[2]; this.data[i + 3] = out[3] ?? 255; }
    }
    return this;
  }
  draw(src, dx = 0, dy = 0) { // alpha-composite another PixelCanvas
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = src.idx(x, y);
      const a = src.data[i + 3];
      if (a === 0) continue;
      this.blend(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
    }
    return this;
  }
  toImageData() { return typeof ImageData !== 'undefined' ? new ImageData(this.data, this.w, this.h) : null; }
}

export function toRGBA(color, alpha) {
  let r, g, b, a = 255;
  if (typeof color === 'number') { r = (color >> 16) & 255; g = (color >> 8) & 255; b = color & 255; }
  else if (typeof color === 'string') {
    const n = parseInt(color.replace('#', ''), 16);
    if (color.length > 7) { r = (n >>> 24) & 255; g = (n >> 16) & 255; b = (n >> 8) & 255; a = n & 255; }
    else { r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  } else { [r, g, b] = color; if (color.length > 3) a = color[3]; }
  if (alpha != null) a = alpha;
  return [r, g, b, a];
}

export function mix(c1, c2, t) {
  const a = toRGBA(c1), b = toRGBA(c2);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export function scale(c, f) { const a = toRGBA(c); return [a[0] * f, a[1] * f, a[2] * f, a[3]]; }

export function seeded(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return mulberry32(h >>> 0);
}
