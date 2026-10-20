// Unlock Manifolds: press 1 to 10 in order; a wrong press resets the sequence.
import { makeCanvas, panel, box, screen, text, led, shuffle, inRect, PALETTE } from '../kit.js';

export default {
  id: 'manifolds',
  title: 'Unlock Manifolds',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const order = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], api.rng);
    const btns = order.map((n, i) => ({ n, x: 35 + (i % 5) * 88, y: 190 + Math.floor(i / 5) * 106, w: 78, h: 92 }));
    let next = 1;
    let flash = 0;
    v.canvas.mgState = { btns }; // exposed for automated tests

    v.onDown((x, y) => {
      if (next > 10) return;
      const b = btns.find((q) => inRect(x, y, q));
      if (!b || b.n < next) return;
      if (b.n === next) {
        next++;
        api.sfx(next > 10 ? 'good' : 'beep');
        if (next > 10) api.complete();
      } else {
        next = 1;
        flash = 0.45;
        api.sfx('bad');
      }
    });

    api.loop((dt) => {
      flash = Math.max(0, flash - dt);
      panel(ctx, w, h, PALETTE.metalDark);
      screen(ctx, 35, 40, 430, 110, 12);
      text(ctx, next > 10 ? 'UNLOCKED' : 'MANIFOLD LOCK', 250, 76, { size: 24, color: next > 10 ? PALETTE.green : PALETTE.cyan });
      for (let i = 0; i < 10; i++) led(ctx, 79 + i * 38, 118, 9, i < next - 1, PALETTE.blue, '#22303c');
      box(ctx, 22, 176, 456, 230, 14, '#3a4652', PALETTE.ink, 5);
      for (const b of btns) {
        const lit = b.n < next;
        const fill = flash > 0 ? PALETTE.red : lit ? PALETTE.blue : PALETTE.metalLight;
        box(ctx, b.x, b.y, b.w, b.h, 10, fill, PALETTE.ink, 5);
        box(ctx, b.x + 6, b.y + b.h - 14, b.w - 12, 7, 3, 'rgba(0,0,0,0.18)', null);
        text(ctx, String(b.n), b.x + b.w / 2, b.y + b.h / 2, {
          size: 38,
          color: lit ? PALETTE.white : PALETTE.ink,
          stroke: lit ? PALETTE.ink : null,
        });
      }
    });

    return () => v.destroy();
  },
};
