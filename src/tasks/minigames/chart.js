// Chart Course: drag the ship along the dotted route through every waypoint.
import { makeCanvas, panel, screen, text, dist, clamp, lerp, PALETTE } from '../kit.js';

const POINTS = [
  [75, 330],
  [165, 165],
  [255, 320],
  [345, 150],
  [430, 285],
];

export default {
  id: 'chart',
  title: 'Chart Course',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const stars = Array.from({ length: 70 }, () => ({
      x: 40 + api.rng() * 420,
      y: 50 + api.rng() * 400,
      r: 0.6 + api.rng() * 1.8,
      p: api.rng() * 6,
    }));
    const ship = { x: POINTS[0][0], y: POINTS[0][1] };
    let reached = 0;
    let dragging = false;
    let done = false;

    function project(x, y) {
      const [ax, ay] = POINTS[reached];
      const [bx, by] = POINTS[reached + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const u = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = ax + dx * u;
      const py = ay + dy * u;
      return { x: px, y: py, off: dist(x, y, px, py) };
    }

    v.onDown((x, y) => {
      if (!done && dist(x, y, ship.x, ship.y) < 40) {
        dragging = true;
        api.sfx('click');
      }
    });
    v.onMove((x, y) => {
      if (!dragging) return;
      const p = project(x, y);
      if (p.off > 60) {
        dragging = false; // strayed off the route; the ship drifts back
        return;
      }
      ship.x = p.x;
      ship.y = p.y;
      const [nx, ny] = POINTS[reached + 1];
      if (dist(ship.x, ship.y, nx, ny) < 25) {
        reached++;
        ship.x = nx;
        ship.y = ny;
        api.sfx('good');
        if (reached === POINTS.length - 1) {
          done = true;
          dragging = false;
          api.complete();
        }
      }
    });
    v.onUp(() => (dragging = false));

    api.loop((dt, t) => {
      if (!dragging) {
        ship.x = lerp(ship.x, POINTS[reached][0], Math.min(1, dt * 10));
        ship.y = lerp(ship.y, POINTS[reached][1], Math.min(1, dt * 10));
      }
      panel(ctx, w, h);
      screen(ctx, 26, 30, 448, 440, 14);
      ctx.fillStyle = '#0d1d3a';
      ctx.fillRect(32, 36, 436, 428);
      for (const s of stars) {
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(t * 2 + s.p);
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      // route
      ctx.lineCap = 'round';
      for (let i = 0; i < POINTS.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(...POINTS[i]);
        ctx.lineTo(...POINTS[i + 1]);
        ctx.setLineDash(i < reached ? [] : [6, 12]);
        ctx.lineWidth = i < reached ? 6 : 5;
        ctx.strokeStyle = i < reached ? PALETTE.yellow : 'rgba(242,246,248,0.8)';
        ctx.stroke();
      }
      ctx.setLineDash([]);
      POINTS.forEach(([x, y], i) => {
        const next = i === reached + 1;
        ctx.beginPath();
        ctx.arc(x, y, next ? 13 + Math.sin(t * 6) * 2 : 12, 0, Math.PI * 2);
        ctx.fillStyle = i <= reached ? PALETTE.yellow : next ? PALETTE.cyan : '#1d3557';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
      });
      // ship, pointing along the current leg
      const [ax, ay] = POINTS[Math.min(reached, POINTS.length - 2)];
      const [bx, by] = POINTS[Math.min(reached + 1, POINTS.length - 1)];
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(Math.atan2(by - ay, bx - ax));
      ctx.beginPath();
      ctx.moveTo(-22, -6);
      ctx.lineTo(-34 - Math.random() * 8, 0);
      ctx.lineTo(-22, 6);
      ctx.fillStyle = '#ff9a2e';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(28, 0);
      ctx.quadraticCurveTo(10, -17, -22, -14);
      ctx.lineTo(-22, 14);
      ctx.quadraticCurveTo(10, 17, 28, 0);
      ctx.fillStyle = PALETTE.white;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(6, 0, 6, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.cyan;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      if (!done && reached === 0 && !dragging) text(ctx, 'Drag the ship along the route', 250, 440, { size: 18 });
    });

    return () => v.destroy();
  },
};
