// Drawing and input helpers shared by every minigame.
// Minigames draw on a canvas with a fixed logical size (default 500x500) that the
// helper scales to fit the panel, so they never deal with screen pixels.

export const PALETTE = {
  metal: '#8a96a3',
  metalDark: '#5b6672',
  metalLight: '#b9c3cc',
  screen: '#1b2a33',
  screenGlow: '#2f4e5c',
  ink: '#0d1114',
  white: '#f2f6f8',
  yellow: '#f5d90a',
  green: '#3ddc5a',
  red: '#e0372f',
  blue: '#2f7de0',
  cyan: '#45e0e8',
};

export const FONT = '"Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const inRect = (x, y, r) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

/**
 * Create a canvas that fills `root`, keeping a w x h logical coordinate space.
 * Returns { canvas, ctx, w, h, onDown, onMove, onUp } where the handlers receive
 * (x, y, event) in logical coordinates. Pointer capture is handled for you.
 */
export function makeCanvas(root, w = 500, h = 500) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mg-canvas';
  canvas.style.aspectRatio = `${w} / ${h}`;
  canvas.style.touchAction = 'none';
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const view = { canvas, ctx, w, h, scale: 1 };

  function resize() {
    const box = root.getBoundingClientRect();
    const s = Math.min(box.width / w, box.height / h) || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${w * s}px`;
    canvas.style.height = `${h * s}px`;
    canvas.width = Math.round(w * s * dpr);
    canvas.height = Math.round(h * s * dpr);
    view.scale = s * dpr;
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  const handlers = { down: [], move: [], up: [] };
  let activeId = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    handlers.down.forEach((f) => f(p.x, p.y, e));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (activeId !== null && e.pointerId !== activeId) return;
    const p = toLocal(e);
    handlers.move.forEach((f) => f(p.x, p.y, e, activeId !== null));
  });
  const end = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    const p = toLocal(e);
    handlers.up.forEach((f) => f(p.x, p.y, e));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  view.onDown = (f) => handlers.down.push(f);
  view.onMove = (f) => handlers.move.push(f);
  view.onUp = (f) => handlers.up.push(f);
  view.destroy = () => ro.disconnect();
  view.resize = resize;
  return view;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Filled + outlined rounded rect in the chunky house style. */
export function box(ctx, x, y, w, h, r, fill, stroke = PALETTE.ink, lineWidth = 4) {
  roundRect(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Brushed-metal panel background with corner screws, covering the whole canvas. */
export function panel(ctx, w, h, color = PALETTE.metal) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (const [sx, sy] of [
    [16, 16],
    [w - 16, 16],
    [16, h - 16],
    [w - 16, h - 16],
  ])
    screw(ctx, sx, sy);
}

export function screw(ctx, x, y, r = 7) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.metalLight;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y - r * 0.6);
  ctx.lineTo(x + r * 0.6, y + r * 0.6);
  ctx.stroke();
}

/** Dark display screen inset. */
export function screen(ctx, x, y, w, h, r = 10) {
  box(ctx, x, y, w, h, r, PALETTE.screen, PALETTE.ink, 5);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(120,200,220,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, r);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Outlined game text. */
export function text(
  ctx,
  str,
  x,
  y,
  { size = 24, color = PALETTE.white, align = 'center', stroke = PALETTE.ink, weight = 800, baseline = 'middle', font } = {},
) {
  ctx.font = `${weight} ${size}px ${font || FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 6);
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/** Small round light (indicator LED). */
export function led(ctx, x, y, r, on, onColor = PALETTE.green, offColor = '#3a2a2a') {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = on ? onColor : offColor;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PALETTE.ink;
  ctx.stroke();
  if (on) {
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
  }
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
