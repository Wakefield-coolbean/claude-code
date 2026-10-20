// Draws the world: cached map chunks, y-sorted characters, effects and the fog of war.
// World units are map cells; `ppc` is device pixels per cell.

import { DIST } from './config.js';
import { THEMES, ROOMS, HALLS } from './map.js';
import { SpriteCache, drawGhost, WALK_FRAMES } from './sprites.js';
import { World } from './grid.js';

const INK = '#07090c';
const SPACE = '#05070d';
const HULL = '#343d4a';
const TASK_YELLOW = '#f5d90a';
const CHUNK = 8;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// Highlight boxes for consoles drawn as props.
const PROP_BOXES = {
  fuel_pe: [7, 9, 5.5, 8],
  fuel_sb: [7, 57, 5.5, 8],
  asteroids_we: [91.5, 8, 3, 3],
  chart_br: [116, 33, 2, 8],
  shields_sh: [96.4, 58.4, 3.2, 3.2],
  admin_map: [69, 35, 6, 3],
};

/** Box [x, y, w, h] of a console's art in cells. */
export function stationBox(id, st) {
  if (PROP_BOXES[id]) return PROP_BOXES[id];
  if (st.wall) {
    const top = Math.floor(st.y);
    return [st.x - 0.45, top - 1.55, 0.9, 1.15];
  }
  switch (st.look) {
    case 'swipe':
      return [st.x - 0.35, st.y - 1.05, 0.7, 0.4];
    case 'fuel':
      return [st.x - 0.6, st.y - 1.3, 1.2, 0.9];
    case 'scanner':
      return [st.x - 0.75, st.y - 0.45, 1.5, 0.9];
    case 'vent':
      return [st.x - 0.7, st.y - 0.95, 1.4, 0.7];
    case 'chute':
      return [st.x - 0.55, st.y - 1.2, 1.1, 0.9];
    case 'hand':
      return [st.x - 0.45, st.y - 1.45, 0.9, 1.0];
    default:
      return [st.x - 0.5, st.y - 1.45, 1.0, 1.0];
  }
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.sprites = new SpriteCache();
    this.chunks = new Map();
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.setGame(game);
    this.resize();
  }

  setGame(game) {
    this.game = game;
    this.map = game.map;
    // Static wall outlines with every door open.
    if (!this.staticSegs || this.staticMap !== game.map) {
      this.staticSegs = new World(game.map).segs;
      this.staticMap = game.map;
      this.chunks.clear();
    }
    const me = game.local || game.players[0];
    this.cam.x = me.x;
    this.cam.y = me.y - 0.5;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.fog.width = this.canvas.width;
    this.fog.height = this.canvas.height;
    const cssPPC = w >= h ? h / DIST.viewHeight : w / 13;
    const ppc = Math.round(cssPPC * dpr * 4) / 4;
    if (ppc !== this.ppc) {
      this.ppc = ppc;
      this.chunks.clear();
      this.sprites.setScale(ppc);
    }
  }

  worldToScreen(x, y) {
    return [(x - this.cam.x) * this.ppc + this.canvas.width / 2, (y - this.cam.y) * this.ppc + this.canvas.height / 2];
  }

  /** CSS-pixel position of a world point (for DOM overlays). */
  worldToCss(x, y) {
    const [sx, sy] = this.worldToScreen(x, y);
    return [sx / this.dpr, sy / this.dpr];
  }

  // ---------- static map ----------
  chunk(cx, cy) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(CHUNK * this.ppc);
    const ctx = c.getContext('2d');
    ctx.scale(this.ppc, this.ppc);
    ctx.translate(-cx * CHUNK, -cy * CHUNK);
    ctx.beginPath();
    ctx.rect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
    ctx.clip();
    this.drawStatic(ctx, cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK);
    if (this.chunks.size > 120) this.chunks.delete(this.chunks.keys().next().value);
    this.chunks.set(key, c);
    return c;
  }

  drawStatic(ctx, x0, y0, x1, y1) {
    const m = this.map;
    const { W, H, floor, face } = m;
    const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (floor[y * W + x] || face[y * W + x]);
    ctx.fillStyle = SPACE;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let y = y0 - 1; y <= y1; y++) {
      for (let x = x0 - 1; x <= x1; x++) {
        if (open(x, y)) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) near = true;
        if (near) {
          ctx.fillStyle = HULL;
          ctx.fillRect(x, y, 1.02, 1.02);
        } else {
          const h = hash(x, y);
          if (h < 0.06) {
            ctx.fillStyle = h < 0.015 ? 'rgba(255,255,255,0.9)' : 'rgba(170,190,255,0.45)';
            const s = 0.05 + h * 1.2;
            ctx.fillRect(x + hash(y, x) * 0.8, y + hash(x + 7, y) * 0.8, s, s);
          }
        }
      }
    }
    const hit = (r) => r[2] > x0 && r[0] < x1 && r[3] > y0 && r[1] < y1;
    HALLS.forEach((r) => hit(r) && this.drawFloor(ctx, r, 'hall'));
    ROOMS.forEach((rm) => hit(rm.rect) && this.drawFloor(ctx, rm.rect, rm.theme));
    // Wall faces.
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const f = face[y * W + x];
        if (!f) continue;
        const th = THEMES[m.faceTheme[y * W + x]] || THEMES.hall;
        ctx.fillStyle = f === 2 ? shadeHex(th[2], 1.12) : th[2];
        ctx.fillRect(x, y, 1.02, 1.02);
        if (f === 1) {
          ctx.fillStyle = shadeHex(th[2], 0.62);
          ctx.fillRect(x, y + 0.8, 1.02, 0.2);
          ctx.fillStyle = shadeHex(th[2], 0.85);
          ctx.fillRect(x, y, 1.02, 0.06);
        } else {
          ctx.fillStyle = shadeHex(th[2], 1.35);
          ctx.fillRect(x, y, 1.02, 0.1);
        }
        if (x % 3 === 0) {
          ctx.fillStyle = shadeHex(th[2], 0.75);
          ctx.fillRect(x, y + (f === 2 ? 0.1 : 0), 0.06, f === 2 ? 0.9 : 0.8);
        }
      }
    }
    this.drawDoorFrames(ctx);
    this.drawVents(ctx, x0, y0, x1, y1);
    for (const p of m.props) this.drawProp(ctx, p);
    for (const [id, st] of Object.entries(m.stations)) this.drawStation(ctx, id, st);
    // Outlines.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const s = this.staticSegs;
    for (let i = 0; i < s.length; i += 4) {
      if (Math.max(s[i], s[i + 2]) < x0 - 1 || Math.min(s[i], s[i + 2]) > x1 + 1) continue;
      if (Math.max(s[i + 1], s[i + 3]) < y0 - 1 || Math.min(s[i + 1], s[i + 3]) > y1 + 1) continue;
      ctx.moveTo(s[i], s[i + 1]);
      ctx.lineTo(s[i + 2], s[i + 3]);
    }
    ctx.stroke();
  }

  drawFloor(ctx, r, key) {
    const [base, line, , accent] = THEMES[key];
    const [x0, y0, x1, y1] = r;
    ctx.fillStyle = base;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const tile = { cafeteria: 2, storage: 3, engine: 2, admin: 2, o2: 2, bridge: 2, shields: 2 }[key] || 1;
    if (key === 'cafeteria') {
      ctx.fillStyle = shadeHex(base, 1.05);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0 + (((y - y0) / 2) % 2) * 2; x < x1; x += 4) ctx.fillRect(x, y, Math.min(2, x1 - x), Math.min(2, y1 - y));
      }
    }
    if (key === 'hall') {
      const horiz = x1 - x0 > y1 - y0;
      ctx.fillStyle = shadeHex(base, 0.85);
      if (horiz) {
        ctx.fillRect(x0, y0, x1 - x0, 0.3);
        ctx.fillRect(x0, y1 - 0.3, x1 - x0, 0.3);
      } else {
        ctx.fillRect(x0, y0, 0.3, y1 - y0);
        ctx.fillRect(x1 - 0.3, y0, 0.3, y1 - y0);
      }
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let x = x0 + tile; x < x1; x += tile) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0 + tile; y < y1; y += tile) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    if (key === 'storage' || key === 'engine' || key === 'reactor') {
      ctx.fillStyle = line;
      for (let y = y0 + tile; y < y1; y += tile) {
        for (let x = x0 + tile; x < x1; x += tile) {
          ctx.beginPath();
          ctx.arc(x - 0.25, y - 0.25, 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (key === 'electrical') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y1 - 0.5, x1 - x0, 0.5);
      ctx.clip();
      for (let x = x0 - 1; x < x1; x += 0.8) {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x + 0.4, y1 - 0.5);
        ctx.lineTo(x + 0.8, y1 - 0.5);
        ctx.lineTo(x + 0.4, y1);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawDoorFrames(ctx) {
    for (const d of this.map.doors) {
      const [x0, y0, x1, y1] = d.rect;
      ctx.fillStyle = '#4a525c';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      if (d.vertical) {
        ctx.fillRect(x0 + 0.3, y0 - 0.05, 0.4, 0.12);
        ctx.fillRect(x0 + 0.3, y1 - 0.07, 0.4, 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.moveTo(x0 + 0.5, y0);
        ctx.lineTo(x0 + 0.5, y1);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x0, y0 + 0.4, x1 - x0, 0.2);
      }
    }
  }

  drawVents(ctx, x0, y0, x1, y1) {
    for (const v of Object.values(this.map.vents)) {
      if (v.x < x0 - 2 || v.x > x1 + 2 || v.y < y0 - 2 || v.y > y1 + 2) continue;
      this.ventGrate(ctx, v.x, v.y, 0);
    }
  }

  ventGrate(ctx, x, y, open) {
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#1a1f26';
    ctx.beginPath();
    ctx.roundRect(x - 0.48, y - 0.32, 0.96, 0.64, 0.08);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -open * 0.45);
    ctx.fillStyle = '#7c8794';
    ctx.beginPath();
    ctx.roundRect(x - 0.44, y - 0.28, 0.88, 0.56, 0.07);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#3a424c';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(x - 0.32, y + i * 0.09);
      ctx.lineTo(x + 0.32, y + i * 0.09);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawProp(ctx, p) {
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    if (p.circle) {
      const [x, y, r] = p.circle;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(x, y + 0.25, r, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === 'table') {
        ctx.fillStyle = '#8d99a5';
        ctx.beginPath();
        ctx.arc(x, y + 0.12, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e4eaef';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (p.button) {
          ctx.fillStyle = '#b8c3cc';
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#d42020';
          ctx.beginPath();
          ctx.arc(x, y - 0.05, 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.ellipse(x - 0.15, y - 0.22, 0.17, 0.1, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(190,230,255,0.75)';
          ctx.lineWidth = 0.06;
          ctx.beginPath();
          ctx.arc(x, y - 0.05, 0.62, Math.PI * 1.1, Math.PI * 1.65);
          ctx.stroke();
        }
      } else if (p.kind === 'core') {
        ctx.fillStyle = '#2b3550';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ['#1d6f9c', '#36a8d8', '#9be8ff'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(x, y - 0.1 * i, r * (0.75 - i * 0.2), 0, Math.PI * 2);
          ctx.fill();
          if (i === 0) ctx.stroke();
        });
      } else if (p.kind === 'generator') {
        ctx.fillStyle = '#6b7684';
        this.hex(ctx, x, y, r);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#c9b24a';
        this.hex(ctx, x, y, r * 0.55);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'gunseat') {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1.6, y - 1.6);
        ctx.stroke();
        ctx.strokeStyle = '#8b96a3';
        ctx.lineWidth = 0.26;
        ctx.stroke();
        ctx.lineWidth = 0.08;
        ctx.strokeStyle = INK;
        ctx.fillStyle = '#58626e';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#a23b3b';
        ctx.beginPath();
        ctx.arc(x, y - 0.1, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    const [x0, y0, x1, y1] = p.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x0 + 0.1, y0 + 0.2, w, h);
    const box = (x, y, bw, bh, fill, r = 0.12) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      ctx.fill();
      ctx.stroke();
    };
    switch (p.kind) {
      case 'bed':
        box(x0, y0, w, h, '#dfe9ee');
        box(x0 + 0.15, y0 + 0.2, 0.7, h - 0.4, '#ffffff', 0.15);
        box(x0 + 1.1, y0 + 0.1, w - 1.2, h - 0.2, '#5fb3c4');
        break;
      case 'engine': {
        box(x0, y0, w, h, '#6a7581', 0.5);
        ctx.fillStyle = '#c9a64a';
        ctx.fillRect(x0 + 0.6, y0 + 0.05, 0.5, h - 0.1);
        ctx.fillRect(x0 + w - 1.4, y0 + 0.05, 0.5, h - 0.1);
        box(x0 + 1.4, y0 + 1, w - 3.2, h - 2, '#87929e', 0.4);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x0 + 0.3, y0 + 0.3, w - 0.6, 0.35);
        ctx.fillStyle = '#ff9a3c';
        ctx.beginPath();
        ctx.ellipse(x0 - 0.1, y0 + h / 2, 0.35, h * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'desk':
        box(x0, y0, w, h, '#4b5563');
        for (let i = 0; i < 3; i++) box(x0 + 0.4 + i * 1.75, y0 - 0.55, 1.4, 0.75, '#2a3440', 0.08);
        for (let i = 0; i < 3; i++) box(x0 + 0.52 + i * 1.75, y0 - 0.45, 1.16, 0.52, '#7ee0a0', 0.05);
        break;
      case 'crate':
        box(x0, y0, w, h, '#9a7546', 0.08);
        ctx.beginPath();
        ctx.moveTo(x0 + 0.2, y0 + 0.2);
        ctx.lineTo(x1 - 0.2, y1 - 0.2);
        ctx.moveTo(x1 - 0.2, y0 + 0.2);
        ctx.lineTo(x0 + 0.2, y1 - 0.2);
        ctx.stroke();
        break;
      case 'console':
        box(x0, y0, w, h, '#59636f');
        box(x0 + 0.25, y0 + 0.2, w - 0.5, h - 0.5, '#3fd0e0', 0.08);
        break;
      case 'maptable': {
        box(x0, y0, w, h, '#2d3a33');
        ctx.strokeStyle = '#7cf29a';
        ctx.lineWidth = 0.07;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
        ctx.beginPath();
        ctx.moveTo(x0 + 1, y0 + h / 2);
        ctx.lineTo(x1 - 1, y0 + h / 2);
        ctx.moveTo(x0 + w / 2, y0 + 0.7);
        ctx.lineTo(x0 + w / 2, y1 - 0.7);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.08;
        break;
      }
      case 'planter':
        box(x0, y0 + 0.3, w, h - 0.3, '#7a5534', 0.08);
        ctx.fillStyle = '#3f9a45';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x0 + 0.5 + (i * (w - 1)) / 2, y0 + 0.25, 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        break;
      case 'pilot':
        box(x0, y0, w, h, '#3c4b5c');
        for (let i = 0; i < 3; i++) box(x0 + 0.3, y0 + 0.6 + i * 2.5, w - 0.6, 1.8, '#61c6ff', 0.1);
        break;
      default:
        box(x0, y0, w, h, '#666');
    }
  }

  hex(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  drawStation(ctx, id, st) {
    if (st.look === 'none') return;
    const [x, y, w, h] = stationBox(id, st);
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = INK;
    const box = (bx, by, bw, bh, fill, r = 0.1) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, r);
      ctx.fill();
      ctx.stroke();
    };
    switch (st.look) {
      case 'wires':
        box(x, y, w, h, '#c7b37a');
        ['#e0372f', '#2f6fe0', '#f5d90a'].forEach((c, i) => {
          ctx.strokeStyle = c;
          ctx.lineWidth = 0.08;
          ctx.beginPath();
          ctx.moveTo(x + 0.2 + i * 0.25, y + 0.2);
          ctx.quadraticCurveTo(x + 0.45, y + 0.6, x + 0.2 + i * 0.25, y + h - 0.2);
          ctx.stroke();
        });
        ctx.strokeStyle = INK;
        break;
      case 'screen':
        box(x, y, w, h, '#4a5562');
        box(x + 0.12, y + 0.12, w - 0.24, h - 0.45, '#3fc8e0', 0.05);
        break;
      case 'sample':
        box(x - 0.2, y, w + 0.4, h, '#e8eef2');
        for (let i = 0; i < 4; i++) box(x + 0.02 + i * 0.25, y + 0.25, 0.14, 0.6, ['#7bd1ff', '#ff7b7b', '#7bd1ff', '#9bff9b'][i], 0.05);
        break;
      case 'dial':
        box(x, y, w, h, '#4a5562');
        ctx.fillStyle = '#f5d90a';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2 - 0.05, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'switch':
        box(x + 0.1, y + 0.1, w - 0.2, h - 0.2, '#6f7b88');
        box(x + w / 2 - 0.1, y + 0.25, 0.2, 0.55, '#e05a2f', 0.05);
        break;
      case 'keypad':
        box(x + 0.1, y, w - 0.2, h, '#5d6874');
        ctx.fillStyle = '#c8d2da';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ctx.fillRect(x + 0.22 + c * 0.17, y + 0.3 + r * 0.2, 0.12, 0.13);
        break;
      case 'hand':
        box(x, y, w, h, '#3a6fd8');
        ctx.fillStyle = '#b9dcff';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.6, 0.22, 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i++) ctx.fillRect(x + w / 2 - 0.2 + i * 0.12, y + 0.2, 0.07, 0.3);
        break;
      case 'swipe':
        box(x, y, w, h, '#2c3640', 0.06);
        ctx.fillStyle = '#5ee36a';
        ctx.fillRect(x + 0.1, y + 0.12, 0.12, 0.12);
        break;
      case 'fuel':
        for (let i = 0; i < 2; i++) {
          box(x + i * 0.62, y + 0.15, 0.55, 0.75, '#d63b2f', 0.08);
          box(x + i * 0.62 + 0.12, y, 0.2, 0.2, '#ffd84a', 0.04);
        }
        break;
      case 'scanner':
        ctx.fillStyle = '#5b6b78';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#7cf2a6';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w * 0.32, h * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'vent':
        box(x, y, w, h, '#9aa6b2');
        ctx.strokeStyle = '#4f5a66';
        for (let i = 1; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 0.28, y + 0.1);
          ctx.lineTo(x + i * 0.28, y + h - 0.1);
          ctx.stroke();
        }
        ctx.strokeStyle = INK;
        break;
      case 'panel':
        box(x, y, w, h, '#7d878f');
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = ['#ff5b4a', '#ffd84a', '#5ee36a'][i];
          ctx.fillRect(x + 0.15 + i * 0.25, y + 0.2, 0.15, 0.15);
        }
        box(x + 0.15, y + 0.5, w - 0.3, 0.35, '#2c3640', 0.04);
        break;
      case 'chute':
        box(x, y, w, h, '#59636f');
        box(x + 0.15, y + 0.15, w - 0.3, h - 0.3, '#262c33', 0.06);
        break;
      case 'console':
        box(x, y, w, h, '#59636f');
        box(x + 0.15, y + 0.15, w - 0.3, h - 0.45, '#3fd0e0', 0.05);
        break;
      case 'dish':
        box(x, y + 0.3, w, h - 0.3, '#59636f');
        ctx.fillStyle = '#d6dde3';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + 0.35, 0.38, Math.PI, 0);
        ctx.fill();
        ctx.stroke();
        break;
      default:
        box(x, y, w, h, '#59636f');
    }
  }

  // ---------- frame ----------
  draw(dt, time) {
    const g = this.game;
    const ctx = this.ctx;
    const me = g.local || g.players[0];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ppc = this.ppc;

    // Camera.
    const tx = me.x;
    const ty = me.y - 0.5;
    const k = Math.min(1, dt * 14);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    if (Math.hypot(tx - this.cam.x, ty - this.cam.y) > 6) {
      this.cam.x = tx;
      this.cam.y = ty;
    }
    let shakeX = 0;
    let shakeY = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      shakeX = (Math.random() - 0.5) * this.shake * 0.6;
      shakeY = (Math.random() - 0.5) * this.shake * 0.6;
    }
    const camX = this.cam.x + shakeX;
    const camY = this.cam.y + shakeY;
    const vx0 = camX - W / 2 / ppc;
    const vy0 = camY - H / 2 / ppc;
    const vx1 = camX + W / 2 / ppc;
    const vy1 = camY + H / 2 / ppc;
    const toS = (x, y) => [(x - camX) * ppc + W / 2, (y - camY) * ppc + H / 2];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SPACE;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    for (let cy = Math.floor(vy0 / CHUNK); cy <= Math.floor(vy1 / CHUNK); cy++) {
      for (let cx = Math.floor(vx0 / CHUNK); cx <= Math.floor(vx1 / CHUNK); cx++) {
        const c = this.chunk(cx, cy);
        const [sx, sy] = toS(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(c, Math.round(sx), Math.round(sy));
      }
    }

    // World-space dynamic layer.
    ctx.setTransform(ppc, 0, 0, ppc, W / 2 - camX * ppc, H / 2 - camY * ppc);
    const t = g.t;
    for (const [id, used] of Object.entries(g.ventUsed)) {
      const age = t - used;
      if (age < 0.6) {
        const v = g.map.vents[id];
        this.ventGrate(ctx, v.x, v.y, Math.sin((age / 0.6) * Math.PI));
      }
    }
    this.drawHighlights(ctx, me, time);

    // Y-sorted drawables.
    const items = [];
    const seeAll = !g.local;
    for (const b of g.bodies) {
      if (seeAll || g.sees(me, b.x, b.y - 0.3)) items.push({ y: b.y, draw: () => this.drawBody(ctx, b) });
    }
    for (const p of g.players) {
      if (p.inVent && p !== me) continue;
      if (p.inVent) continue;
      if (!p.alive && me.alive && !seeAll) continue;
      if (p.alive && !seeAll && !g.seesPlayer(me, p)) continue;
      items.push({ y: p.y, draw: () => this.drawPlayer(ctx, p, time) });
    }
    for (const d of g.map.doors) {
      if (!g.world.doorClosed[d.id]) continue;
      items.push({ y: d.vertical ? d.rect[3] : d.rect[3], draw: () => this.drawDoor(ctx, d) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    this.drawVisualFx(ctx, me, time);

    // Fog of war.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (me.alive && g.local) {
      const [ex, ey] = g.eye(me);
      const r = g.visionOf(me);
      const poly = g.world.visibility(ex, ey, r);
      const f = this.fogCtx;
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, W, H);
      f.fillStyle = 'rgba(3,5,10,0.8)';
      f.fillRect(0, 0, W, H);
      f.globalCompositeOperation = 'destination-out';
      const [cx, cy] = toS(ex, ey);
      const grad = f.createRadialGradient(cx, cy, 0, cx, cy, r * ppc);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.82, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = grad;
      f.beginPath();
      for (let i = 0; i < poly.length; i += 2) {
        const [sx, sy] = toS(poly[i], poly[i + 1]);
        if (i) f.lineTo(sx, sy);
        else f.moveTo(sx, sy);
      }
      f.closePath();
      f.fill();
      ctx.drawImage(this.fog, 0, 0);
    }

    // Name tags (above fog so they read like the original).
    ctx.font = `800 ${Math.round(ppc * 0.34)}px "Baloo 2", "Arial Rounded MT Bold", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, ppc * 0.07);
    for (const p of g.players) {
      if (p.inVent) continue;
      if (!p.alive && me.alive && !seeAll) continue;
      if (p.alive && !seeAll && !g.seesPlayer(me, p)) continue;
      const [sx, sy] = toS(p.x, p.y - 1.32);
      const teammate = me.role === 'impostor' && p.role === 'impostor';
      ctx.globalAlpha = p.alive ? 1 : 0.6;
      ctx.strokeStyle = INK;
      ctx.strokeText(p.name, sx, sy);
      ctx.fillStyle = teammate ? '#ff2a2a' : '#ffffff';
      ctx.fillText(p.name, sx, sy);
    }
    ctx.globalAlpha = 1;

    // Critical sabotage flash.
    const sab = g.sab.active;
    if (sab && (sab.type === 'reactor' || sab.type === 'o2') && g.phase === 'play') {
      const pulse = (Math.sin(time * Math.PI * 2) + 1) / 2;
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, `rgba(255,0,0,${0.06 + pulse * 0.08})`);
      vg.addColorStop(1, `rgba(255,0,0,${0.3 + pulse * 0.25})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    this.drawArrows(ctx, me, toS, time);
  }

  drawPlayer(ctx, p, time) {
    const [sx, sy] = this.worldToScreenWith(p.x, p.y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!p.alive) {
      const f = Math.floor(time * 6) % 6;
      const bmp = this.sprites.get(`g${p.colorIndex}:${f}`, p.color, p.shadow, (c, a, b) => drawGhost(c, a, b, f / 6));
      const bob = Math.sin(time * 3 + p.id) * 0.08 * this.ppc;
      this.sprites.blit(ctx, bmp, sx, sy - 0.15 * this.ppc + bob, p.facing, this.ppc, 0.55);
      ctx.restore();
      return;
    }
    const frame = p.moving ? Math.floor(p.walk * 16) % WALK_FRAMES : -1;
    // Soft floor shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 0.36 * this.ppc, 0.12 * this.ppc, 0, 0, Math.PI * 2);
    ctx.fill();
    this.sprites.blit(ctx, this.sprites.crewmate(p, frame), sx, sy, p.facing, this.ppc);
    ctx.restore();
  }

  drawBody(ctx, b) {
    const [sx, sy] = this.worldToScreenWith(b.x, b.y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = this.game.players[b.id];
    this.sprites.blit(ctx, this.sprites.body(b, p.colorIndex), sx, sy, 1, this.ppc);
    ctx.restore();
  }

  worldToScreenWith(x, y) {
    // Matches the current world transform (camera incl. shake).
    const m = this.ctx.getTransform();
    return [x * m.a + m.e, y * m.d + m.f];
  }

  drawDoor(ctx, d) {
    const [x0, y0, x1, y1] = d.rect;
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = INK;
    if (d.vertical) {
      ctx.fillStyle = '#8c97a3';
      ctx.beginPath();
      ctx.roundRect(x0 + 0.18, y0 - 1.1, 0.64, y1 - y0 + 1.1, 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6c7682';
      ctx.fillRect(x0 + 0.3, y0 - 0.9, 0.4, y1 - y0 + 0.7);
    } else {
      const h = 1.7;
      ctx.fillStyle = '#8c97a3';
      ctx.beginPath();
      ctx.roundRect(x0, y1 - h, x1 - x0, h, 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2, y1 - h);
      ctx.lineTo((x0 + x1) / 2, y1);
      ctx.stroke();
      ctx.fillStyle = '#f5d90a';
      for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.6) ctx.fillRect(x, y1 - 0.55, 0.3, 0.2);
    }
  }

  drawHighlights(ctx, me, time) {
    const g = this.game;
    if (!g.local || me.inVent || g.phase !== 'play') return;
    const glow = 0.65 + Math.sin(time * 5) * 0.25;
    const outline = (box, color, near) => {
      const [x, y, w, h] = box;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = near ? 1 : glow;
      ctx.lineWidth = near ? 0.16 : 0.1;
      ctx.beginPath();
      ctx.roundRect(x - 0.08, y - 0.08, w + 0.16, h + 0.16, 0.14);
      ctx.stroke();
      ctx.restore();
    };
    const use = g.usable(me);
    for (const [id, st] of Object.entries(g.map.stations)) {
      let color = null;
      if (st.sabotage) {
        if (g.sab.active?.type === st.sabotage && me.alive && !g.fixPointDone(id)) color = '#ff4a3a';
      } else if (!st.tool && me.role !== 'impostor' && g.stepsAt(me, id).length) {
        color = TASK_YELLOW;
      } else if (st.tool && me.alive && use?.station === id) {
        color = TASK_YELLOW;
      }
      if (color) outline(stationBox(id, st), color, use?.station === id);
    }
    if (use?.kind === 'button') {
      const b = g.map.button;
      outline([b.x - 0.8, b.y - 0.85, 1.6, 1.6], TASK_YELLOW, true);
    }
  }

  drawVisualFx(ctx, me, time) {
    const g = this.game;
    for (const [id, fx] of g.visualFx) {
      const p = g.players[id];
      const vis = !g.local || g.seesPlayer(me, p);
      if (!vis) continue;
      if (fx.kind === 'scan') {
        ctx.save();
        ctx.strokeStyle = 'rgba(80,255,140,0.9)';
        ctx.lineWidth = 0.06;
        for (let i = 0; i < 3; i++) {
          const ph = (time * 0.8 + i / 3) % 1;
          ctx.globalAlpha = 1 - ph;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 0.05, 0.5 + ph * 0.4, 0.18 + ph * 0.14, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        const sy = p.y - 0.1 - ((Math.sin(time * 3) + 1) / 2) * 1.15;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#5dff9a';
        ctx.fillRect(p.x - 0.5, sy - 0.04, 1, 0.08);
        ctx.restore();
      } else if (fx.kind === 'asteroids') {
        const [gx, gy] = [94.6, 7.9];
        const seed = Math.floor(time * 3);
        const a = -Math.PI / 2 + (Math.sin(seed * 12.9898) * 0.5 + 0.5) * 1.3 - 0.4;
        const ph = (time * 3) % 1;
        ctx.save();
        ctx.strokeStyle = `rgba(255,120,80,${1 - ph})`;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + Math.cos(a) * 9, gy + Math.sin(a) * 9);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,220,120,${1 - ph})`;
        ctx.beginPath();
        ctx.arc(gx + Math.cos(a) * 9, gy + Math.sin(a) * 9, 0.3 + ph * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (fx.kind === 'shields') {
        ctx.save();
        ctx.globalAlpha = 0.5 + Math.sin(time * 6) * 0.3;
        ctx.fillStyle = '#fff36b';
        this.hex(ctx, 98, 60, 1.25);
        ctx.fill();
        ctx.restore();
      } else if (fx.kind === 'garbage') {
        const st = g.map.stations[p.y < 40 ? 'garbage_ca' : 'garbage_st'];
        ctx.save();
        for (let i = 0; i < 6; i++) {
          const ph = (time * 1.2 + i / 6) % 1;
          ctx.globalAlpha = 1 - ph;
          ctx.fillStyle = ['#7a5534', '#3f9a45', '#9aa6b2'][i % 3];
          ctx.fillRect(st.x - 0.3 + ((i * 37) % 7) / 10, st.y - 0.8 + ph * 1.4, 0.18, 0.18);
        }
        ctx.restore();
      }
    }
  }

  /** Arrows toward multi-step task locations and sabotage fix points. */
  drawArrows(ctx, me, toS, time) {
    const g = this.game;
    if (!g.local || g.phase !== 'play') return;
    const targets = [];
    const sab = g.sab.active;
    if (sab && me.alive) {
      for (const [id, st] of Object.entries(g.map.stations)) {
        if (st.sabotage === sab.type && !g.fixPointDone(id)) targets.push([st.x, st.y, '#ff3b30']);
      }
    }
    const commsDown = sab?.type === 'comms';
    if (!commsDown && me.role !== 'impostor') {
      for (const task of me.tasks) {
        if (task.done || task.step === 0 || g.t < task.readyAt) continue;
        const st = g.map.stations[task.steps[task.step].station];
        targets.push([st.x, st.y, TASK_YELLOW]);
      }
    }
    const W = this.canvas.width;
    const H = this.canvas.height;
    const [px, py] = toS(me.x, me.y - 0.5);
    for (const [x, y, color] of targets) {
      const [sx, sy] = toS(x, y);
      const dx = sx - px;
      const dy = sy - py;
      const d = Math.hypot(dx, dy);
      if (d < this.ppc * 2.5) continue;
      const margin = this.ppc * 0.9;
      // Pin to the screen edge when off-screen, else hover over the target.
      let ax = sx;
      let ay = sy - this.ppc * 1.6;
      if (sx < margin || sx > W - margin || sy < margin || sy > H - margin) {
        const s = Math.min(Math.abs((W / 2 - margin) / (dx || 1e-6)), Math.abs((H / 2 - margin) / (dy || 1e-6)));
        ax = px + dx * s;
        ay = py + dy * s;
        ax = Math.max(margin, Math.min(W - margin, ax));
        ay = Math.max(margin, Math.min(H - margin, ay));
      }
      const ang = Math.atan2(sy - ay, sx - ax);
      const bounce = Math.sin(time * 6) * this.ppc * 0.08;
      ctx.save();
      ctx.translate(ax + Math.cos(ang) * bounce, ay + Math.sin(ang) * bounce);
      ctx.rotate(ang);
      const s = this.ppc * 0.45;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.6, -s * 0.7);
      ctx.lineTo(-s * 0.25, 0);
      ctx.lineTo(-s * 0.6, s * 0.7);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, this.ppc * 0.07);
      ctx.strokeStyle = INK;
      ctx.lineJoin = 'round';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
