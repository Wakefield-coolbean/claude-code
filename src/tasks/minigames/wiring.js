// Fix Wiring: drag each wire on the left to the same color on the right.
import { makeCanvas, panel, box, led, shuffle, dist, PALETTE } from '../kit.js';

const WIRES = ['#e0372f', '#2f6fe0', '#f5d90a', '#d23ad6'];

export default {
  id: 'wiring',
  title: 'Fix Wiring',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const ys = [110, 200, 290, 380];
    const left = shuffle(WIRES, api.rng);
    const right = shuffle(WIRES, api.rng);
    const done = new Array(4).fill(false); // indexed by left slot
    let drag = null; // { from, x, y }

    v.onDown((x, y) => {
      ys.forEach((yy, i) => {
        if (!done[i] && dist(x, y, 62, yy) < 40) {
          drag = { from: i, x, y };
          api.sfx('click');
        }
      });
    });
    v.onMove((x, y) => {
      if (drag) {
        drag.x = x;
        drag.y = y;
      }
    });
    v.onUp((x, y) => {
      if (!drag) return;
      const color = left[drag.from];
      const target = ys.findIndex((yy, j) => dist(x, y, 438, yy) < 45 && right[j] === color);
      if (target >= 0) {
        done[drag.from] = true;
        api.sfx('good');
        if (done.every(Boolean)) api.complete();
      }
      drag = null;
    });

    function wire(x1, y1, x2, y2, color) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 14;
      ctx.stroke();
    }

    api.loop(() => {
      panel(ctx, w, h, '#6d5a49');
      box(ctx, 30, 40, 440, 420, 14, '#3a2d24', PALETTE.ink, 5);
      ys.forEach((yy, i) => {
        // left terminal
        box(ctx, 34, yy - 18, 50, 36, 6, left[i]);
        // right terminal + light
        box(ctx, 416, yy - 18, 50, 36, 6, right[i]);
        const rightDone = left.some((c, k) => done[k] && c === right[i]);
        led(ctx, 486 - 8, yy - 30, 8, rightDone, PALETTE.yellow);
      });
      ys.forEach((yy, i) => {
        if (done[i]) {
          const j = right.indexOf(left[i]);
          wire(84, yy, 416, ys[j], left[i]);
        } else {
          wire(70, yy, 92, yy, left[i]);
        }
      });
      if (drag) wire(84, ys[drag.from], drag.x, drag.y, left[drag.from]);
    });

    return () => v.destroy();
  },
};
