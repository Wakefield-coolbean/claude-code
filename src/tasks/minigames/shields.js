// Prime Shields (visual task): tap every red hexagon until the whole array glows white.
import { makeCanvas, panel, screen, text, shuffle, dist, PALETTE } from '../kit.js';

const S = 64; // hexagon circumradius
const C = { x: 250, y: 262 };

export default {
  id: 'shields',
  title: 'Prime Shields',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    api.act({ type: 'visual', on: true });
    const gap = Math.sqrt(3) * S * 1.07;
    const cells = [{ x: C.x, y: C.y, red: false }];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      cells.push({ x: C.x + Math.cos(a) * gap, y: C.y + Math.sin(a) * gap, red: false });
    }
    const reds = 2 + Math.floor(api.rng() * 4);
    shuffle(cells, api.rng)
      .slice(0, reds)
      .forEach((c) => (c.red = true));
    let done = false;
    v.canvas.mgState = { cells }; // exposed for automated tests

    v.onDown((x, y) => {
      if (done) return;
      const c = cells.find((q) => dist(x, y, q.x, q.y) < S * 0.86);
      if (!c) return;
      c.red = !c.red;
      api.sfx(c.red ? 'bad' : 'beep');
      if (cells.every((q) => !q.red)) {
        done = true;
        api.complete();
      }
    });

    function hex(c, t) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = ((k * 60 - 90) * Math.PI) / 180;
        ctx.lineTo(c.x + Math.cos(a) * S, c.y + Math.sin(a) * S);
      }
      ctx.closePath();
      ctx.save();
      ctx.shadowColor = c.red ? 'rgba(255,60,40,0.7)' : 'rgba(180,240,255,0.9)';
      ctx.shadowBlur = c.red ? 8 : 16 + Math.sin(t * 4) * 4;
      ctx.fillStyle = c.red ? PALETTE.red : '#eef6f9';
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 6;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, S * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = c.red ? '#8e1d17' : '#9fd6e6';
      ctx.stroke();
    }

    api.loop((dt, t) => {
      panel(ctx, w, h, PALETTE.metalDark);
      screen(ctx, 22, 22, 456, 456, 18);
      cells.forEach((c) => hex(c, t));
      const left = cells.filter((c) => c.red).length;
      text(ctx, left ? `${left} OFFLINE` : 'SHIELDS PRIMED', 250, 462, { size: 18, color: left ? PALETTE.red : PALETTE.green });
    });

    return () => {
      api.act({ type: 'visual', on: false });
      v.destroy();
    };
  },
};
