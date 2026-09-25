// Canvas 2D GUI toolkit: integer GUI scale, bitmap font, sprites, panels, slots, item icons, tooltips.
import { FONT, glyphFor, textWidth as fontTextWidth, FORMAT_COLORS } from '../textures/font.js';
import { ItemById } from '../registry/items.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}
export function imageToCanvas(img) {
  const c = makeCanvas(img.w, img.h);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(img.w, img.h);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return c;
}

const CHARS = [];
for (let i = 32; i < 127; i++) CHARS.push(String.fromCharCode(i));
for (const ch of '§°•→←✔✖█░') CHARS.push(ch);

export class Gui {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 2;
    this.width = 320; this.height = 240;
    this.sprites = new Map();
    this.icons = null;      // IconCache
    this.fontAtlas = new Map(); // color -> canvas
    this.glyphX = new Map();
    this.buildGlyphLayout();
  }

  setSprites(map) { for (const [k, v] of map) this.sprites.set(k, imageToCanvas(v)); }

  resize(w, h, setting = 0) {
    this.canvas.width = w; this.canvas.height = h;
    // vanilla auto scale: largest scale where the screen is at least 320x240 gui pixels
    let s = 1;
    const max = setting > 0 ? setting : 1000;
    while (s < max && w / (s + 1) >= 320 && h / (s + 1) >= 240) s++;
    this.scale = s;
    this.width = Math.floor(w / s);
    this.height = Math.floor(h / s);
    this.ctx.imageSmoothingEnabled = false;
  }

  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  // ---------- primitives ----------
  fill(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }
  gradient(x, y, w, h, top, bottom) {
    const g = this.ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x, y, w, h);
  }
  sprite(name, x, y, sx = 0, sy = 0, sw, sh, dw, dh) {
    const img = this.sprites.get(name);
    if (!img) return;
    sw = sw ?? img.width; sh = sh ?? img.height;
    this.ctx.drawImage(img, sx, sy, sw, sh, x, y, dw ?? sw, dh ?? sh);
  }
  // 9-slice a sprite with the given border (px)
  nineSlice(name, x, y, w, h, b = 3) {
    const img = this.sprites.get(name);
    if (!img) return;
    const iw = img.width, ih = img.height, c = this.ctx;
    const d = (sx, sy, sw, sh, dx, dy, dw, dh) => { if (sw > 0 && sh > 0 && dw > 0 && dh > 0) c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); };
    // left half + right half like vanilla buttons (keeps texture detail)
    const lw = Math.min(Math.floor(w / 2), iw - b), rw = w - lw;
    const th = Math.min(Math.floor(h / 2), ih - b), bh = h - th;
    d(0, 0, lw, th, x, y, lw, th);
    d(iw - rw, 0, rw, th, x + lw, y, rw, th);
    d(0, ih - bh, lw, bh, x, y + th, lw, bh);
    d(iw - rw, ih - bh, rw, bh, x + lw, y + th, rw, bh);
  }

  // ---------- font ----------
  buildGlyphLayout() {
    let x = 0;
    for (const ch of CHARS) {
      const g = glyphFor(ch);
      this.glyphX.set(ch, x);
      x += g.width + 1;
    }
    this.atlasWidth = x;
  }
  atlas(color) {
    let a = this.fontAtlas.get(color);
    if (a) return a;
    a = makeCanvas(this.atlasWidth, FONT.cellHeight);
    const c = a.getContext('2d');
    const id = c.createImageData(this.atlasWidth, FONT.cellHeight);
    const [r, g, b] = parseColor(color);
    for (const ch of CHARS) {
      const gl = glyphFor(ch), gx = this.glyphX.get(ch);
      gl.rows.forEach((row, yy) => {
        for (let xx = 0; xx < gl.width; xx++) if (row[xx] === '#') {
          const i = (yy * this.atlasWidth + gx + xx) * 4;
          id.data[i] = r; id.data[i + 1] = g; id.data[i + 2] = b; id.data[i + 3] = 255;
        }
      });
    }
    c.putImageData(id, 0, 0);
    this.fontAtlas.set(color, a);
    return a;
  }
  textWidth(str) { return fontTextWidth(String(str)); }

  // draws text; supports § colour codes. color: '#rrggbb'
  text(str, x, y, color = '#ffffff', shadow = true) {
    str = String(str);
    if (shadow) this.drawString(str, x + 1, y + 1, color, true);
    return this.drawString(str, x, y, color, false);
  }
  drawString(str, x, y, color, isShadow) {
    const c = this.ctx;
    let cx = x;
    let col = color;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '§' && i + 1 < str.length) {
        const k = str[i + 1].toLowerCase();
        if (FORMAT_COLORS[k]) { const v = FORMAT_COLORS[k]; col = `#${v.map((n) => n.toString(16).padStart(2, '0')).join('')}`; i++; continue; }
        if (k === 'r') { col = color; i++; continue; }
        if ('klmno'.includes(k)) { i++; continue; }
      }
      const g = glyphFor(ch);
      const gx = this.glyphX.get(ch) ?? this.glyphX.get('?');
      const drawCol = isShadow ? shadowOf(col) : col;
      c.drawImage(this.atlas(drawCol), gx, 0, g.width, FONT.cellHeight, cx, y, g.width, FONT.cellHeight);
      cx += g.width + 1;
    }
    return cx;
  }
  textCentered(str, cx, y, color = '#ffffff', shadow = true) {
    this.text(str, Math.round(cx - this.textWidth(str) / 2), y, color, shadow);
  }
  textRight(str, rx, y, color = '#ffffff', shadow = true) {
    this.text(str, rx - this.textWidth(str), y, color, shadow);
  }
  // word-wrap to width
  wrap(str, width) {
    const words = String(str).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (this.textWidth(t) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ---------- vanilla container drawing ----------
  panel(x, y, w, h) {
    const c = this.ctx;
    c.fillStyle = '#000000';
    c.fillRect(x + 2, y, w - 4, 1); c.fillRect(x + 2, y + h - 1, w - 4, 1);
    c.fillRect(x, y + 2, 1, h - 4); c.fillRect(x + w - 1, y + 2, 1, h - 4);
    c.fillRect(x + 1, y + 1, 1, 1); c.fillRect(x + w - 2, y + 1, 1, 1); c.fillRect(x + 1, y + h - 2, 1, 1); c.fillRect(x + w - 2, y + h - 2, 1, 1);
    c.fillStyle = '#c6c6c6';
    c.fillRect(x + 1, y + 2, w - 2, h - 4); c.fillRect(x + 2, y + 1, w - 4, h - 2);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 2, y + 1, w - 5, 2); c.fillRect(x + 1, y + 2, 2, h - 5); c.fillRect(x + 3, y + 3, 1, 1);
    c.fillStyle = '#555555';
    c.fillRect(x + 3, y + h - 3, w - 5, 2); c.fillRect(x + w - 3, y + 3, 2, h - 5); c.fillRect(x + w - 4, y + h - 4, 1, 1);
  }
  slot(x, y, w = 18, h = 18) {
    const c = this.ctx;
    c.fillStyle = '#373737'; c.fillRect(x, y, w - 1, 1); c.fillRect(x, y, 1, h - 1);
    c.fillStyle = '#ffffff'; c.fillRect(x + 1, y + h - 1, w - 1, 1); c.fillRect(x + w - 1, y + 1, 1, h - 1);
    c.fillStyle = '#8b8b8b'; c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = '#8b8b8b'; c.fillRect(x + w - 1, y, 1, 1); c.fillRect(x, y + h - 1, 1, 1);
  }
  slotHighlight(x, y) {
    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
    this.ctx.fillRect(x, y, 16, 16);
  }
  darkOverlay() {
    this.gradient(0, 0, this.width, this.height, 'rgba(16,16,16,0.75)', 'rgba(16,16,16,0.82)');
  }
  dirtBackground(offset = 0) {
    const img = this.sprites.get('options_background');
    if (!img) { this.fill(0, 0, this.width, this.height, '#2b1d14'); return; }
    const c = this.ctx;
    const s = 32;
    for (let y = -((offset) % s); y < this.height; y += s) for (let x = 0; x < this.width; x += s) c.drawImage(img, 0, 0, 16, 16, x, y, s, s);
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillRect(0, 0, this.width, this.height);
  }

  // ---------- items ----------
  item(stack, x, y, { count = true, bar = true } = {}) {
    if (!stack || stack.empty) return;
    const icon = this.icons?.get(stack.id);
    if (icon) this.ctx.drawImage(icon, 0, 0, icon.width, icon.height, x, y, 16, 16);
    if (stack.tag?.enchantments?.length || stack.item?.glint) this.glint(x, y, icon);
    const it = stack.item;
    if (bar && it?.durability && stack.damage > 0) {
      const f = 1 - stack.damage / it.durability;
      const w = Math.round(13 * f);
      const hue = Math.max(0, f) / 3;
      this.fill(x + 2, y + 13, 13, 2, '#000000');
      this.fill(x + 2, y + 13, w, 1, hsl(hue));
    }
    if (count && stack.count > 1) {
      const s = String(stack.count);
      this.text(s, x + 17 - this.textWidth(s), y + 9, '#ffffff', true);
    }
  }
  glint(x, y, icon) {
    const t = performance.now() / 3000;
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.35 + 0.1 * Math.sin(t * 6);
    if (icon) {
      // purple sheen masked by the icon
      c.drawImage(icon, x, y, 16, 16);
      c.globalCompositeOperation = 'source-atop';
    }
    c.restore();
    c.save();
    c.beginPath(); c.rect(x, y, 16, 16); c.clip();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(128,64,204,0.35)';
    const off = ((t * 32) % 32) - 16;
    c.beginPath(); c.moveTo(x + off, y + 16); c.lineTo(x + off + 6, y + 16); c.lineTo(x + off + 22, y); c.lineTo(x + off + 16, y); c.fill();
    c.restore();
  }

  tooltip(lines, mx, my) {
    if (!lines.length) return;
    const w = Math.max(...lines.map((l) => this.textWidth(l.text ?? l)));
    const h = lines.length === 1 ? 8 : 8 + 2 + (lines.length - 1) * 10;
    let x = mx + 12, y = my - 12;
    if (x + w + 4 > this.width) x = mx - 16 - w;
    if (y + h + 6 > this.height) y = this.height - h - 6;
    if (y < 4) y = 4;
    const c = this.ctx;
    c.fillStyle = 'rgba(16,0,16,0.94)';
    c.fillRect(x - 3, y - 4, w + 6, 1); c.fillRect(x - 3, y + h + 3, w + 6, 1);
    c.fillRect(x - 3, y - 3, w + 6, h + 6); c.fillRect(x - 4, y - 3, 1, h + 6); c.fillRect(x + w + 3, y - 3, 1, h + 6);
    const g = c.createLinearGradient(0, y - 3, 0, y + h + 3);
    g.addColorStop(0, 'rgba(80,0,255,0.31)'); g.addColorStop(1, 'rgba(40,0,127,0.31)');
    c.fillStyle = g;
    c.fillRect(x - 3, y - 3 + 1, 1, h + 4); c.fillRect(x + w + 2, y - 3 + 1, 1, h + 4);
    c.fillStyle = 'rgba(80,0,255,0.31)'; c.fillRect(x - 3, y - 3, w + 6, 1);
    c.fillStyle = 'rgba(40,0,127,0.31)'; c.fillRect(x - 3, y + h + 2, w + 6, 1);
    lines.forEach((l, i) => {
      const t = l.text ?? l, col = l.color ?? (i === 0 ? '#ffffff' : '#aaaaaa');
      this.text(t, x, y + (i === 0 ? 0 : 2 + i * 10), col, true);
    });
  }

  itemTooltip(stack, mx, my, advanced = false) {
    const it = stack.item;
    const lines = [];
    const rarity = it.rarity ?? (stack.tag?.enchantments?.length ? 'rare' : 'common');
    const color = { common: '#ffffff', uncommon: '#ffff55', rare: '#55ffff', epic: '#ff55ff' }[rarity];
    lines.push({ text: stack.tag?.name ?? it.display, color });
    for (const e of stack.tag?.enchantments ?? []) lines.push({ text: `${enchantName(e.id)} ${roman(e.lvl)}`, color: e.id === 'binding_curse' || e.id === 'vanishing_curse' ? '#ff5555' : '#aaaaaa' });
    if (it.damage !== undefined && it.attackSpeed !== undefined) {
      lines.push({ text: '', color: '#aaaaaa' });
      lines.push({ text: 'When in Main Hand:', color: '#aaaaaa' });
      lines.push({ text: ` ${fmt(it.damage)} Attack Damage`, color: '#00aa00' });
      lines.push({ text: ` ${fmt(it.attackSpeed)} Attack Speed`, color: '#00aa00' });
    }
    if (it.armor) {
      lines.push({ text: '', color: '#aaaaaa' });
      lines.push({ text: `When on ${({ head: 'Head', chest: 'Body', legs: 'Legs', feet: 'Feet' })[it.armor.slot]}:`, color: '#aaaaaa' });
      lines.push({ text: `+${it.armor.points} Armor`, color: '#5555ff' });
      if (it.armor.toughness) lines.push({ text: `+${it.armor.toughness} Armor Toughness`, color: '#5555ff' });
    }
    if (advanced) {
      if (it.durability) lines.push({ text: `Durability: ${it.durability - stack.damage} / ${it.durability}`, color: '#ffffff' });
      lines.push({ text: `blockcraft:${it.name}`, color: '#555555' });
    }
    this.tooltip(lines, mx, my);
  }
}

function fmt(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10); }
function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n); }
function enchantName(id) { return id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); }
function hsl(h) {
  const r = Math.round(255 * Math.max(0, Math.min(1, Math.abs(h * 6 - 3) - 1)));
  const g = Math.round(255 * Math.max(0, Math.min(1, 2 - Math.abs(h * 6 - 2))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 2 - Math.abs(h * 6 - 4))));
  return `rgb(${r},${g},${b})`;
}
function parseColor(c) {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = c.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
}
function shadowOf(c) {
  const [r, g, b] = parseColor(c);
  return `#${[r >> 2, g >> 2, b >> 2].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
export { makeCanvas, ItemById };
