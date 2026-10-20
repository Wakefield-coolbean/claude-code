// Fix Lights: flip all five breaker switches on. Switch state is shared, so it is
// always read from api.state() and changed through api.act().
import { makeCanvas, panel, box, text, led, inRect, PALETTE } from '../kit.js';

function stripes(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.yellow;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PALETTE.ink;
  for (let sx = x - h; sx < x + w; sx += 40) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + 20, y + h);
    ctx.lineTo(sx + 20 + h, y);
    ctx.lineTo(sx + h, y);
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PALETTE.ink;
  ctx.strokeRect(x, y, w, h);
}

export default {
  id: 'lights',
  title: 'Fix Lights',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const slots = [0, 1, 2, 3, 4].map((i) => ({ x: 62 + i * 80, y: 190, w: 56, h: 170 }));
    let done = false;
    const switches = () => api.state().switches || [];

    v.onDown((x, y) => {
      if (done) return;
      const i = slots.findIndex((r) => inRect(x, y, { x: r.x - 10, y: r.y - 50, w: r.w + 20, h: r.h + 60 }));
      if (i < 0) return;
      api.act({ type: 'toggle', index: i });
      api.sfx('click');
    });

    api.loop(() => {
      const s = switches();
      panel(ctx, w, h, '#7d8a78');
      box(ctx, 34, 40, 432, 420, 16, '#56624f', PALETTE.ink, 5);
      text(ctx, 'BREAKERS', 250, 88, { size: 30, color: PALETTE.yellow });
      slots.forEach((r, i) => {
        const on = !!s[i];
        led(ctx, r.x + r.w / 2, r.y - 34, 13, on);
        box(ctx, r.x, r.y, r.w, r.h, 10, '#22282b');
        box(ctx, r.x + r.w / 2 - 6, r.y + 18, 12, r.h - 36, 6, '#0b0e10', null);
        const ky = on ? r.y + 12 : r.y + r.h - 62;
        box(ctx, r.x + 5, ky, r.w - 10, 50, 8, on ? '#e4e9ec' : '#8d969d');
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 3;
        for (let g = 0; g < 3; g++) {
          ctx.beginPath();
          ctx.moveTo(r.x + 14, ky + 14 + g * 11);
          ctx.lineTo(r.x + r.w - 14, ky + 14 + g * 11);
          ctx.stroke();
        }
        text(ctx, on ? 'ON' : 'OFF', r.x + r.w / 2, r.y + r.h + 22, { size: 18, color: on ? PALETTE.green : '#c9cfd3' });
      });
      stripes(ctx, 52, 416, 396, 26);
      if (!done && s.length && s.every(Boolean)) {
        done = true;
        api.complete();
      }
    });

    return () => v.destroy();
  },
};
