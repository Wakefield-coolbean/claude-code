// Clear Asteroids (visual task): shoot 20 asteroids drifting across the targeting screen.
import { makeCanvas, panel, screen, text, PALETTE, dist } from '../kit.js';

const GOAL = 20;
const SCR = { x: 20, y: 20, w: 460, h: 460 };

export default {
  id: 'asteroids',
  title: 'Clear Asteroids',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const rng = api.rng;
    const stars = Array.from({ length: 50 }, () => ({ x: SCR.x + rng() * SCR.w, y: SCR.y + rng() * SCR.h, r: 0.6 + rng() * 1.4 }));
    let rocks = [];
    let bursts = [];
    let shots = [];
    let destroyed = 0;
    let spawnIn = 0;
    let aim = { x: 250, y: 250 };
    let done = false;
    api.act({ type: 'visual', on: true });

    function spawn() {
      const r = 18 + rng() * 22;
      const pts = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * Math.PI * 2, d: r * (0.75 + rng() * 0.3) }));
      rocks.push({
        x: SCR.x + SCR.w + r,
        y: SCR.y + 40 + rng() * (SCR.h - 80),
        vx: -(60 + rng() * 110),
        vy: (rng() - 0.5) * 40,
        r,
        rot: 0,
        spin: (rng() - 0.5) * 3,
        pts,
      });
    }

    v.onMove((x, y) => (aim = { x, y }));
    v.onDown((x, y) => {
      if (done) return;
      aim = { x, y };
      shots.push({ x, y, t: 0.12 });
      const hit = rocks.findLast((r) => dist(x, y, r.x, r.y) < r.r + 10);
      if (!hit) {
        api.sfx('click');
        return;
      }
      rocks = rocks.filter((r) => r !== hit);
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        bursts.push({ x: hit.x, y: hit.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, t: 0.45 });
      }
      destroyed++;
      api.sfx('good');
      if (destroyed >= GOAL) {
        done = true;
        api.complete();
      }
    });

    api.loop((dt) => {
      spawnIn -= dt;
      if (!done && spawnIn <= 0 && rocks.length < 7) {
        spawn();
        spawnIn = 0.45 + rng() * 0.5;
      }
      rocks.forEach((r) => {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rot += r.spin * dt;
      });
      rocks = rocks.filter((r) => r.x > SCR.x - r.r * 2);
      bursts.forEach((b) => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.t -= dt;
      });
      bursts = bursts.filter((b) => b.t > 0);
      shots.forEach((s) => (s.t -= dt));
      shots = shots.filter((s) => s.t > 0);

      panel(ctx, w, h, '#5b6672');
      screen(ctx, SCR.x, SCR.y, SCR.w, SCR.h, 14);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(SCR.x + 4, SCR.y + 4, SCR.w - 8, SCR.h - 8, 12);
      ctx.clip();
      ctx.fillStyle = '#0a1418';
      ctx.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
      ctx.fillStyle = 'rgba(200,240,255,0.6)';
      stars.forEach((s) => ctx.fillRect(s.x, s.y, s.r, s.r));

      rocks.forEach((r) => {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.rot);
        ctx.beginPath();
        r.pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](Math.cos(p.a) * p.d, Math.sin(p.a) * p.d));
        ctx.closePath();
        ctx.fillStyle = '#7a6a58';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#7dff8a';
        ctx.stroke();
        ctx.fillStyle = '#5e5044';
        ctx.beginPath();
        ctx.arc(r.r * 0.25, -r.r * 0.2, r.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      bursts.forEach((b) => {
        ctx.fillStyle = `rgba(255,200,80,${b.t * 2})`;
        ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
      });
      shots.forEach((s) => {
        ctx.strokeStyle = `rgba(125,255,138,${s.t * 8})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(SCR.x, SCR.y + SCR.h);
        ctx.lineTo(s.x, s.y);
        ctx.moveTo(SCR.x + SCR.w, SCR.y + SCR.h);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      });
      ctx.restore();

      // crosshair
      ctx.strokeStyle = '#7dff8a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, 18, 0, Math.PI * 2);
      ctx.moveTo(aim.x - 28, aim.y);
      ctx.lineTo(aim.x + 28, aim.y);
      ctx.moveTo(aim.x, aim.y - 28);
      ctx.lineTo(aim.x, aim.y + 28);
      ctx.stroke();

      text(ctx, `Destroyed: ${destroyed}/${GOAL}`, SCR.x + 18, SCR.y + 26, {
        size: 22,
        color: '#7dff8a',
        stroke: PALETTE.ink,
        align: 'left',
      });
    });

    return () => {
      api.act({ type: 'visual', on: false });
      v.destroy();
    };
  },
};
