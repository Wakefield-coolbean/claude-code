// Clean O2 Filter: drag every leaf into the intake on the left.
import { makeCanvas, panel, box, screen, dist, PALETTE } from '../kit.js';

const VENT = { x: 24, y: 150, w: 76, h: 200 };
const LEAF_COLORS = [
  ['#4fae3b', '#2d6e22'],
  ['#86c443', '#4f7d22'],
  ['#3c8f4d', '#215a2d'],
];

export default {
  id: 'filter',
  title: 'Clean O2 Filter',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const leaves = Array.from({ length: 6 }, (_, i) => ({
      x: 175 + api.rng() * 270,
      y: 80 + api.rng() * 340,
      rot: api.rng() * Math.PI * 2,
      vx: (api.rng() - 0.5) * 16,
      vy: (api.rng() - 0.5) * 16,
      c: LEAF_COLORS[i % 3],
      suck: 0,
      gone: false,
    }));
    let drag = null;
    let finished = false;
    v.canvas.mgState = { leaves, VENT }; // exposed for automated tests

    const inVent = (l) => l.x < VENT.x + VENT.w + 8 && l.y > VENT.y && l.y < VENT.y + VENT.h;
    const suck = (l) => {
      l.suck = 0.001;
      api.sfx('whoosh');
    };

    v.onDown((x, y) => {
      for (let i = leaves.length - 1; i >= 0; i--) {
        const l = leaves[i];
        if (l.gone || l.suck || dist(x, y, l.x, l.y) > 38) continue;
        leaves.push(...leaves.splice(i, 1)); // draw the held leaf on top
        drag = { l, dx: l.x - x, dy: l.y - y };
        api.sfx('click');
        return;
      }
    });
    v.onMove((x, y) => {
      if (!drag) return;
      drag.l.x = x + drag.dx;
      drag.l.y = y + drag.dy;
      if (inVent(drag.l)) {
        suck(drag.l);
        drag = null;
      }
    });
    v.onUp(() => (drag = null));

    function leaf(l) {
      const s = l.suck ? 1 - l.suck : 1;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.quadraticCurveTo(0, -24, 30, 0);
      ctx.quadraticCurveTo(0, 24, -34, 0);
      ctx.fillStyle = l.c[0];
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-40, 0);
      ctx.lineTo(22, 0);
      ctx.lineWidth = 3;
      ctx.strokeStyle = l.c[1];
      ctx.stroke();
      ctx.restore();
    }

    api.loop((dt, t) => {
      for (const l of leaves) {
        if (l.gone) continue;
        if (l.suck) {
          l.suck += dt * 2.5;
          l.x += (VENT.x + 24 - l.x) * Math.min(1, dt * 8);
          l.y += (VENT.y + VENT.h / 2 - l.y) * Math.min(1, dt * 4);
          l.rot += dt * 12;
          if (l.suck >= 1) l.gone = true;
        } else if (!drag || drag.l !== l) {
          l.x += l.vx * dt;
          l.y += l.vy * dt;
          if (l.x < 150 || l.x > 460) l.vx *= -1;
          if (l.y < 70 || l.y > 430) l.vy *= -1;
          l.rot += Math.sin(t * 1.5 + l.vx) * dt * 0.4;
        }
      }
      if (!finished && leaves.every((l) => l.gone)) {
        finished = true;
        api.complete();
      }

      panel(ctx, w, h);
      screen(ctx, 112, 34, 362, 432, 14);
      ctx.save();
      ctx.beginPath();
      ctx.rect(117, 39, 352, 422);
      ctx.clip();
      ctx.strokeStyle = 'rgba(160,190,200,0.22)';
      ctx.lineWidth = 2;
      for (let k = -500; k < 500; k += 22) {
        ctx.beginPath();
        ctx.moveTo(117 + k, 39);
        ctx.lineTo(117 + k + 422, 461);
        ctx.moveTo(117 + k + 422, 39);
        ctx.lineTo(117 + k, 461);
        ctx.stroke();
      }
      ctx.restore();
      // intake vent with moving airflow
      box(ctx, VENT.x, VENT.y, VENT.w, VENT.h, 10, '#141a1f', PALETTE.ink, 5);
      ctx.strokeStyle = PALETTE.metalDark;
      ctx.lineWidth = 6;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(VENT.x + 8, VENT.y + i * 28);
        ctx.lineTo(VENT.x + VENT.w - 8, VENT.y + i * 28);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(170,230,255,0.35)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const ox = 160 - ((t * 120 + i * 40) % 160);
        const oy = VENT.y + 30 + i * 46;
        ctx.beginPath();
        ctx.moveTo(VENT.x + VENT.w + ox, oy);
        ctx.lineTo(VENT.x + VENT.w + ox + 26, oy);
        ctx.stroke();
      }
      leaves.forEach((l) => !l.gone && leaf(l));
    });

    return () => v.destroy();
  },
};
