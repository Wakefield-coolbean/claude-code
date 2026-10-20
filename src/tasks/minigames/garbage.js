// Empty Garbage (visual): pull the lever down and hold it until the chute is empty.
import { makeCanvas, panel, box, text, dist, clamp, PALETTE } from '../kit.js';

const PULL_TIME = 2.5;
const CHUTE = { x: 110, y: 50, w: 240, h: 340 };
const HATCH_Y = CHUTE.y + CHUTE.h;
const LEVER = { x: 425, top: 110, bottom: 390 };

function drawItem(ctx, it, y) {
  ctx.save();
  ctx.translate(it.x, y);
  ctx.rotate(it.rot);
  ctx.lineWidth = 3;
  ctx.strokeStyle = PALETTE.ink;
  ctx.fillStyle = it.color;
  ctx.beginPath();
  if (it.kind === 'leaf') ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2);
  else if (it.kind === 'can') ctx.roundRect(-12, -20, 24, 40, 6);
  else if (it.kind === 'paper') ctx.rect(-18, -14, 36, 28);
  else ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (it.kind === 'can') {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-12, -6, 24, 8);
  }
  ctx.restore();
}

export default {
  id: 'garbage',
  title: 'Empty Garbage',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const kinds = [
      ['leaf', '#4caf50'],
      ['leaf', '#7bc043'],
      ['can', '#c0392b'],
      ['can', '#9aa6b2'],
      ['paper', '#f2f2f2'],
      ['bit', '#8d6e63'],
    ];
    const items = Array.from({ length: 28 }, () => {
      const [kind, color] = kinds[Math.floor(api.rng() * kinds.length)];
      return {
        kind,
        color,
        x: CHUTE.x + 28 + api.rng() * (CHUTE.w - 56),
        baseY: 120 + api.rng() * 250,
        rot: api.rng() * 6,
        fallen: false,
        fy: 0,
        vy: 0,
      };
    });
    const fillTop = Math.min(...items.map((i) => i.baseY));
    let lever = 0; // 0 top, 1 bottom
    let dragging = false;
    let pulling = false;
    let progress = 0;
    let hatch = 0;
    let done = false;

    api.act({ type: 'visual', on: true });
    const leverY = () => LEVER.top + lever * (LEVER.bottom - LEVER.top);

    v.onDown((x, y) => {
      if (done || dist(x, y, LEVER.x, leverY()) > 48) return;
      dragging = true;
      api.sfx('click');
    });
    v.onMove((x, y) => {
      if (dragging) lever = clamp((y - LEVER.top) / (LEVER.bottom - LEVER.top), 0, 1);
    });
    v.onUp(() => (dragging = false));

    api.loop((dt) => {
      const wasPulling = pulling;
      pulling = dragging && lever > 0.85 && progress < 1;
      if (pulling && !wasPulling) api.sfx('whoosh');
      if (!dragging || progress >= 1) lever = Math.max(0, lever - dt * 4);
      if (pulling) progress = Math.min(1, progress + dt / PULL_TIME);
      hatch += ((pulling ? 1 : 0) - hatch) * Math.min(1, dt * 12);
      const drop = progress * (HATCH_Y - fillTop + 20);

      panel(ctx, w, h, '#7c8794');
      box(ctx, CHUTE.x, CHUTE.y, CHUTE.w, CHUTE.h, 10, '#2b3137', PALETTE.ink, 6);
      ctx.save();
      ctx.beginPath();
      ctx.rect(CHUTE.x + 3, CHUTE.y + 3, CHUTE.w - 6, CHUTE.h - 3);
      ctx.clip();
      for (const it of items) {
        if (it.fallen) continue;
        const y = it.baseY + drop;
        if (pulling && y > HATCH_Y - 8) {
          it.fallen = true;
          it.fy = y;
          it.vy = 120;
        } else drawItem(ctx, it, y);
      }
      ctx.fillStyle = 'rgba(180,220,235,0.12)';
      ctx.fillRect(CHUTE.x + 14, CHUTE.y + 10, 26, CHUTE.h - 30);
      ctx.restore();

      for (const it of items) {
        if (!it.fallen || it.fy > 560) continue;
        it.vy += 1200 * dt;
        it.fy += it.vy * dt;
        drawItem(ctx, it, it.fy);
      }

      // Hatch flap hinged on the left.
      ctx.save();
      ctx.translate(CHUTE.x, HATCH_Y);
      ctx.rotate(hatch * 1.3);
      box(ctx, 0, -6, CHUTE.w, 14, 4, '#5b6672');
      ctx.restore();

      // Lever.
      box(ctx, LEVER.x - 12, LEVER.top - 20, 24, LEVER.bottom - LEVER.top + 40, 12, '#20262b');
      const ly = leverY();
      ctx.lineWidth = 14;
      ctx.strokeStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.moveTo(LEVER.x - 70, ly);
      ctx.lineTo(LEVER.x, ly);
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#b9c3cc';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(LEVER.x, ly, 30, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.red;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      text(ctx, progress >= 1 ? 'EMPTY' : 'PULL', LEVER.x, 455, { size: 22, color: progress >= 1 ? PALETTE.green : PALETTE.white });

      if (!done && progress >= 1 && items.every((i) => i.fallen)) {
        done = true;
        api.complete();
      }
    });

    return () => {
      api.act({ type: 'visual', on: false });
      v.destroy();
    };
  },
};
