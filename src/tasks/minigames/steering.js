// Stabilize Steering: drag the crosshair back to the center of the navigation display.
import { makeCanvas, panel, text, dist, PALETTE } from '../kit.js';

const C = 250;
const R = 200;

export default {
  id: 'steering',
  title: 'Stabilize Steering',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const a = api.rng() * Math.PI * 2;
    const r = 90 + api.rng() * 80;
    const cross = { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
    let drag = null;
    let done = false;
    v.canvas.mgState = { cross }; // exposed for automated tests

    v.onDown((x, y) => {
      if (done || dist(x, y, cross.x, cross.y) > 50) return;
      drag = { dx: cross.x - x, dy: cross.y - y };
      api.sfx('click');
    });
    v.onMove((x, y) => {
      if (!drag) return;
      let nx = x + drag.dx - C;
      let ny = y + drag.dy - C;
      const d = Math.hypot(nx, ny);
      if (d > R - 24) {
        nx *= (R - 24) / d;
        ny *= (R - 24) / d;
      }
      cross.x = C + nx;
      cross.y = C + ny;
    });
    v.onUp(() => {
      if (!drag) return;
      drag = null;
      if (dist(cross.x, cross.y, C, C) < 14) {
        cross.x = C;
        cross.y = C;
        done = true;
        api.sfx('good');
        api.complete();
      }
    });

    api.loop((dt, t) => {
      panel(ctx, w, h);
      ctx.beginPath();
      ctx.arc(C, C, R + 12, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.metalDark;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.fillStyle = '#0f2f38';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110,220,200,0.35)';
      ctx.lineWidth = 2;
      for (const rr of [50, 100, 150]) {
        ctx.beginPath();
        ctx.arc(C, C, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(C - R, C);
      ctx.lineTo(C + R, C);
      ctx.moveTo(C, C - R);
      ctx.lineTo(C, C + R);
      ctx.stroke();
      // radar sweep
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.arc(C, C, R - 3, t * 1.6, t * 1.6 + 0.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(110,220,200,0.14)';
      ctx.fill();
      ctx.restore();
      // center target
      const near = dist(cross.x, cross.y, C, C) < 14;
      ctx.beginPath();
      ctx.arc(C, C, 14, 0, Math.PI * 2);
      ctx.fillStyle = near ? PALETTE.green : 'rgba(61,220,90,0.35)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      // crosshair
      const col = near ? PALETTE.green : PALETTE.yellow;
      for (const [lw, c] of [
        [10, PALETTE.ink],
        [5, col],
      ]) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(cross.x, cross.y, 30, 0, Math.PI * 2);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          ctx.moveTo(cross.x + dx * 18, cross.y + dy * 18);
          ctx.lineTo(cross.x + dx * 44, cross.y + dy * 44);
        }
        ctx.stroke();
      }
      if (!done && !drag) text(ctx, 'Center the crosshair', C, 480, { size: 17 });
    });

    return () => v.destroy();
  },
};
