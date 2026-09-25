// Animated intro: an isometric floating island assembles block by block, then the BlockCraft logo lands.
// Click or press any key to skip. Everything here is drawn with the game's own procedural textures.
import { Screen, TitleScreen } from './screens.js';
import { rgbaToCanvas } from '../render/icons.js';

const GRASS = [124, 189, 107], FOLIAGE = [89, 174, 48];
const FALL = 0.45; // seconds a block takes to fall into place

export class IntroScreen extends Screen {
  constructor(game) {
    super(game);
    this.start = performance.now();
    this.leaving = 0;
    this.landed = new Set();
    this.tex = {};
    this.buildScene();
    this.motes = Array.from({ length: 60 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 0.7, p: i * 1.7 }));
  }
  get pausesGame() { return false; }
  get closesOnEsc() { return false; }

  buildScene() {
    const blocks = [];
    const add = (i, j, k, kind) => blocks.push({ i, j, k, kind });
    const R = 3;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const d = Math.abs(i) + Math.abs(j);
      if (d > R + 1 || (Math.abs(i) === R && Math.abs(j) === R)) continue;
      const depth = 3 - Math.min(2, Math.floor(d / 2));
      for (let k = -depth; k < 0; k++) add(i, j, k, k === -1 ? 'grass' : k === -2 ? 'dirt' : 'stone');
    }
    // a little tree and a few stones on top
    for (let k = 0; k < 3; k++) add(-1, -1, k, 'log');
    for (let i = -2; i <= 0; i++) for (let j = -2; j <= 0; j++) for (let k = 2; k <= 3; k++) {
      if (i === -1 && j === -1 && k === 2) continue;
      if (k === 3 && (i !== -1 || j !== -1) && (Math.abs(i + 1) + Math.abs(j + 1)) > 1) continue;
      add(i, j, k, 'leaves');
    }
    add(1, 1, 0, 'cobble'); add(2, 1, 0, 'cobble'); add(1, 2, 0, 'cobble'); add(1, 1, 1, 'cobble');
    // falling order: bottom layers first, sweeping across the island
    blocks.sort((a, b) => a.k - b.k || (a.i + a.j) - (b.i + b.j) || a.i - b.i);
    const span = 2.0;
    blocks.forEach((b, n) => { b.t = 0.35 + (n / blocks.length) * span; b.id = n; });
    this.blocks = blocks;
    this.drawOrder = blocks.slice().sort((a, b) => (a.i + a.j) - (b.i + b.j) || a.k - b.k || a.i - b.i);
    this.logoAt = 0.35 + span + FALL + 0.15;
  }

  texture(name, tint) {
    const key = name + (tint ? tint.join() : '');
    if (this.tex[key] !== undefined) return this.tex[key];
    const frames = this.game.icons?.blockTexMap?.get(name);
    return (this.tex[key] = frames ? rgbaToCanvas(frames[0], 16, 16, tint) : null);
  }
  faces(kind) {
    switch (kind) {
      case 'grass': return { top: this.texture('grass_block_top', GRASS), side: this.texture('dirt'), overlay: this.texture('grass_block_side_overlay', GRASS) };
      case 'dirt': return { top: this.texture('dirt'), side: this.texture('dirt') };
      case 'stone': return { top: this.texture('stone'), side: this.texture('stone') };
      case 'cobble': return { top: this.texture('cobblestone'), side: this.texture('cobblestone') };
      case 'log': return { top: this.texture('oak_log_top'), side: this.texture('oak_log') };
      default: return { top: this.texture('oak_leaves', FOLIAGE), side: this.texture('oak_leaves', FOLIAGE) };
    }
  }

  skip() {
    if (this.leaving) return;
    this.leaving = performance.now();
    try { this.game.sound.play('random.click', { volume: 0.4 }); } catch (e) { /* audio locked */ }
  }
  mouseDown() { this.skip(); return true; }
  keyDown() { this.skip(); return true; }

  // isometric cube; (X, Y) = screen position of the top face's back corner, a = half tile width
  cube(c, X, Y, a, f, alpha) {
    const face = (img, m, shade) => {
      c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (img) c.drawImage(img, 0, 0, 16, 16); else { c.fillStyle = '#777'; c.fillRect(0, 0, 16, 16); }
      if (shade) { c.fillStyle = `rgba(0,0,0,${shade})`; c.fillRect(0, 0, 16, 16); }
    };
    const k = a / 16;
    c.globalAlpha = alpha;
    const base = this.gui.ctx.getTransform();
    const T = (m) => { const d = new DOMMatrix(m); return base.multiply(d); };
    const apply = (img, m, shade) => { const t = T(m); face(img, [t.a, t.b, t.c, t.d, t.e, t.f], shade); };
    apply(f.top, [k, k / 2, -k, k / 2, X, Y]);
    apply(f.side, [k, k / 2, 0, k, X - a, Y + a / 2], 0.18);
    if (f.overlay) apply(f.overlay, [k, k / 2, 0, k, X - a, Y + a / 2], 0);
    apply(f.side, [k, -k / 2, 0, k, X, Y + a], 0.38);
    if (f.overlay) apply(f.overlay, [k, -k / 2, 0, k, X, Y + a], 0);
    c.setTransform(base);
    c.globalAlpha = 1;
  }

  render(gui) {
    const c = gui.ctx, W = this.width, H = this.height;
    const now = performance.now();
    const t = (now - this.start) / 1000;
    c.save();
    c.imageSmoothingEnabled = false;
    // night-sky backdrop with slow light rays
    const bg = c.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#2b3f6b'); bg.addColorStop(0.55, '#121a33'); bg.addColorStop(1, '#05070f');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H * 0.42); c.rotate(t * 0.05);
    for (let r = 0; r < 12; r++) {
      c.rotate(Math.PI / 6);
      c.fillStyle = `rgba(160,190,255,${0.035 + 0.02 * Math.sin(t + r)})`;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.max(W, H), -40); c.lineTo(Math.max(W, H), 40); c.fill();
    }
    c.restore();
    for (const m of this.motes) {
      const x = ((m.x + Math.sin(t * 0.3 + m.p) * 0.02) % 1) * W, y = ((m.y - t * 0.02 * m.s) % 1 + 1) % 1 * H;
      c.fillStyle = `rgba(255,240,200,${0.25 + 0.35 * Math.abs(Math.sin(t * 2 + m.p))})`;
      c.fillRect(Math.round(x), Math.round(y), m.s > 0.8 ? 2 : 1, m.s > 0.8 ? 2 : 1);
    }

    // island
    const a = Math.max(6, Math.floor(Math.min(W / 18, H / 15)));
    const bob = Math.sin(t * 1.2) * a * 0.12;
    const ox = W / 2, oy = H * 0.66 + bob;
    let shake = 0;
    for (const b of this.drawOrder) {
      const p = (t - b.t) / FALL;
      if (p < 0) continue;
      if (p >= 1 && !this.landed.has(b.id)) {
        this.landed.add(b.id);
        if (b.id % 4 === 0) try { this.game.sound.play(b.kind === 'leaves' ? 'dig.grass' : b.kind === 'log' ? 'dig.wood' : 'dig.stone', { volume: 0.15, pitch: 0.8 + Math.random() * 0.4 }); } catch (e) { /* audio locked */ }
      }
      const q = Math.min(1, p);
      const drop = (1 - q) * (1 - q) * H * 0.7;
      const settle = p >= 1 && p < 1.4 ? Math.sin((p - 1) / 0.4 * Math.PI) * a * 0.12 : 0;
      if (p >= 1 && p < 1.25) shake = Math.max(shake, 1);
      const X = ox + (b.i - b.j) * a, Y = oy + (b.i + b.j) * a / 2 - (b.k + 1) * a - drop - settle;
      this.cube(c, X, Y, a, this.faces(b.kind), Math.min(1, p * 3));
    }

    // logo slam + shine
    const logo = gui.sprites.get('__logo');
    const lt = t - this.logoAt;
    if (logo && lt > 0) {
      const lw = Math.min(274, W - 20), s = lw / logo.width, lh = logo.height * s;
      const e = Math.min(1, lt / 0.35);
      const sc = e < 1 ? 2.2 - 1.2 * e * e : 1 + Math.max(0, 0.06 * Math.sin((lt - 0.35) * 18) * Math.exp(-(lt - 0.35) * 6));
      c.save();
      c.translate(W / 2, H * 0.1 + lh / 2);
      c.scale(sc, sc);
      c.globalAlpha = Math.min(1, lt / 0.25);
      c.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
      // shine sweep across the logo
      const sx = ((lt - 0.5) / 1.2) * (lw + 80) - lw / 2 - 40;
      if (lt > 0.5 && lt < 1.7) {
        c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(sx - 20, 0, sx + 20, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(-lw / 2, -lh / 2, lw, lh);
      }
      c.restore();
      if (lt < 0.45 && lt > 0.3) shake = 3;
      if (lt > 0.7) {
        const sub = 'A fan-made block adventure';
        const n = Math.min(sub.length, Math.floor((lt - 0.7) * 30));
        gui.textCentered(sub.slice(0, n), W / 2, Math.round(H * 0.1 + lh + 8), '#ffe9a8');
      }
    }
    if (t > this.logoAt + 1.8) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      c.globalAlpha = pulse;
      gui.textCentered('Click or press any key', W / 2, H - 22, '#ffffff');
      c.globalAlpha = 1;
    }
    gui.textRight('Not affiliated with Mojang', W - 2, H - 10, '#8088a0');

    // screen shake is applied as a quick flash-offset of the whole frame
    if (shake > 0) { c.globalAlpha = 0.06 * shake; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    // fade in / out
    const fadeIn = Math.max(0, 1 - t / 0.5);
    let fadeOut = 0;
    if (!this.leaving && t > this.logoAt + 6) this.skip();
    if (this.leaving) {
      fadeOut = Math.min(1, (now - this.leaving) / 400);
      if (fadeOut >= 1) { c.restore(); this.game.setScreen(new TitleScreen(this.game)); return; }
    }
    const f = Math.max(fadeIn, fadeOut);
    if (f > 0) { c.fillStyle = `rgba(0,0,0,${f})`; c.fillRect(0, 0, W, H); }
    c.restore();
  }
}
