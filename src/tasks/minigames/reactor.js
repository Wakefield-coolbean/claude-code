// Reactor Meltdown: hold your hand on this scanner while someone holds the other one.
import { makeCanvas, panel, screen, text, led, roundRect, inRect, PALETTE } from '../kit.js';

// Hand print: palm, four fingers, thumb (logical coordinates).
function handPath(ctx) {
  ctx.beginPath();
  ctx.roundRect(180, 228, 140, 130, 42);
  [
    [195, 132],
    [233, 102],
    [270, 100],
    [306, 124],
  ].forEach(([fx, top]) => ctx.roundRect(fx - 15, top, 30, 250 - top, 15));
  ctx.save();
  ctx.translate(184, 300);
  ctx.rotate(-0.75);
  ctx.roundRect(-16, -78, 32, 86, 16);
  ctx.restore();
}

export default {
  id: 'reactor',
  title: 'Reactor Meltdown',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const pad = { x: 110, y: 60, w: 280, h: 330 };
    let holding = false;
    let done = false;
    let t = 0;

    const setHold = (on) => {
      if (holding === on) return;
      holding = on;
      api.act({ type: 'hold', on });
      if (on) api.sfx('beep');
    };
    v.onDown((x, y) => {
      if (!done && inRect(x, y, pad)) setHold(true);
    });
    v.onUp(() => setHold(false));

    api.loop((dt) => {
      t += dt;
      const s = api.state();
      const both = holding && s.holders >= (s.needed || 2);
      panel(ctx, w, h, '#8d8f99');
      screen(ctx, pad.x, pad.y, pad.w, pad.h, 18);
      ctx.save();
      roundRect(ctx, pad.x + 4, pad.y + 4, pad.w - 8, pad.h - 8, 16);
      ctx.clip();
      ctx.strokeStyle = 'rgba(80,200,230,0.12)';
      ctx.lineWidth = 2;
      for (let gy = pad.y + 20; gy < pad.y + pad.h; gy += 22) {
        ctx.beginPath();
        ctx.moveTo(pad.x, gy);
        ctx.lineTo(pad.x + pad.w, gy);
        ctx.stroke();
      }
      // Stroke first, then an opaque fill hides the seams between palm and fingers.
      handPath(ctx);
      ctx.lineWidth = 14;
      ctx.strokeStyle = holding ? (both ? PALETTE.green : PALETTE.cyan) : '#4f7d8c';
      ctx.stroke();
      ctx.fillStyle = PALETTE.screen;
      ctx.fill();
      ctx.fillStyle = holding ? 'rgba(69,224,232,0.35)' : 'rgba(79,125,140,0.25)';
      ctx.fill();
      if (holding) {
        const sy = pad.y + ((t * 220) % pad.h);
        const g = ctx.createLinearGradient(0, sy - 30, 0, sy);
        g.addColorStop(0, 'rgba(61,220,90,0)');
        g.addColorStop(1, 'rgba(61,220,90,0.55)');
        ctx.fillStyle = g;
        ctx.fillRect(pad.x, sy - 30, pad.w, 30);
        ctx.fillStyle = PALETTE.green;
        ctx.fillRect(pad.x, sy - 3, pad.w, 5);
      }
      ctx.restore();

      const blink = Math.floor(t * 3) % 2 === 0;
      led(ctx, 60, 440, 14, !s.fixed && blink, PALETTE.red);
      led(ctx, 440, 440, 14, !s.fixed && !blink, PALETTE.red);
      const msg = !holding ? 'HOLD TO STOP MELTDOWN' : both ? 'STABILIZING...' : 'WAITING FOR SECOND USER';
      text(ctx, msg, 250, 440, { size: 22, color: holding && !both ? PALETTE.yellow : PALETTE.white });

      if (!done && s.fixed) {
        done = true;
        api.complete();
      }
    });

    return () => {
      api.act({ type: 'hold', on: false });
      v.destroy();
    };
  },
};
