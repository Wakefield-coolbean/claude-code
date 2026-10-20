// Calibrate Distributor: press CALIBRATE while each spinning marker sits in its notch, top to bottom.
import { makeCanvas, panel, box, screen, text, inRect, PALETTE } from '../kit.js';

const TAU = Math.PI * 2;
const NOTCH = 0.38; // half-width of the target notch, radians
const ROWS = [
  { color: '#f5d90a', speed: 2.4 },
  { color: '#2f7de0', speed: 3.1 },
  { color: '#45e0e8', speed: 3.8 },
];
const angDiff = (a, b) => Math.abs(((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI);

export default {
  id: 'distributor',
  title: 'Calibrate Distributor',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const rows = ROWS.map((r, i) => ({
      ...r,
      y: 95 + i * 155,
      angle: api.rng() * TAU,
      notch: api.rng() * TAU,
      locked: false,
      fill: 0,
    }));
    let current = 0;
    let flash = 0;
    v.canvas.mgState = { rows, NOTCH, angDiff }; // exposed for automated tests

    const button = (r) => ({ x: 360, y: r.y - 32, w: 115, h: 64 });

    v.onDown((x, y) => {
      if (current >= rows.length) return;
      rows.forEach((r, i) => {
        if (!inRect(x, y, button(r))) return;
        if (i !== current) return api.sfx('click');
        if (angDiff(r.angle, r.notch) <= NOTCH) {
          r.locked = true;
          r.angle = r.notch;
          current++;
          api.sfx('good');
          if (current === rows.length) api.complete();
        } else {
          rows.forEach((q) => (q.locked = false));
          current = 0;
          flash = 0.4;
          api.sfx('bad');
        }
      });
    });

    api.loop((dt) => {
      flash = Math.max(0, flash - dt);
      panel(ctx, w, h);
      rows.forEach((r, i) => {
        if (!r.locked) r.angle = (r.angle + r.speed * dt) % TAU;
        r.fill = r.locked ? Math.min(1, r.fill + dt * 3) : 0;
        const cx = 90;
        const cy = r.y;
        const R = 56;
        // dial
        screen(ctx, cx - R - 8, cy - R - 8, (R + 8) * 2, (R + 8) * 2, R + 8);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, r.notch - NOTCH, r.notch + NOTCH);
        ctx.closePath();
        ctx.fillStyle = r.color + '66';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.lineWidth = 5;
        ctx.strokeStyle = r.color;
        ctx.stroke();
        const nx = cx + Math.cos(r.angle) * (R - 4);
        const ny = cy + Math.sin(r.angle) * (R - 4);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx, ny);
        ctx.lineWidth = 12;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        ctx.lineWidth = 6;
        ctx.strokeStyle = PALETTE.white;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, TAU);
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        // charge bar
        box(ctx, 172, cy - 20, 168, 40, 10, PALETTE.screen, PALETTE.ink, 5);
        if (r.fill > 0) box(ctx, 178, cy - 14, 156 * r.fill, 28, 7, r.color, null);
        // button
        const b = button(r);
        const active = i === current;
        box(ctx, b.x, b.y, b.w, b.h, 12, r.locked ? PALETTE.green : active ? r.color : PALETTE.metalDark, PALETTE.ink, 5);
        text(ctx, r.locked ? 'OK' : 'CALIBRATE', b.x + b.w / 2, cy + 2, { size: r.locked ? 26 : 18 });
      });
      if (flash > 0) {
        ctx.fillStyle = `rgba(224,55,47,${flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    });

    return () => v.destroy();
  },
};
