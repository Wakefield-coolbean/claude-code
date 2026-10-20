// Submit Scan (visual task): stand still while the medical scanner reads your vitals.
import { makeCanvas, panel, box, screen, text, PALETTE } from '../kit.js';
import { TIMING } from '../../config.js';

function bean(ctx, cx, by, s, color, shadow) {
  ctx.lineWidth = 6;
  ctx.strokeStyle = PALETTE.ink;
  // backpack
  ctx.beginPath();
  ctx.roundRect(cx - 0.62 * s, by - 1.0 * s, 0.32 * s, 0.6 * s, 0.1 * s);
  ctx.fillStyle = shadow;
  ctx.fill();
  ctx.stroke();
  // body and legs
  ctx.beginPath();
  ctx.moveTo(cx - 0.42 * s, by - 0.15 * s);
  ctx.lineTo(cx - 0.42 * s, by - 0.8 * s);
  ctx.arc(cx, by - 0.8 * s, 0.42 * s, Math.PI, 0);
  ctx.lineTo(cx + 0.42 * s, by);
  ctx.lineTo(cx + 0.06 * s, by);
  ctx.lineTo(cx + 0.06 * s, by - 0.15 * s);
  ctx.lineTo(cx - 0.06 * s, by - 0.15 * s);
  ctx.lineTo(cx - 0.06 * s, by);
  ctx.lineTo(cx - 0.42 * s, by);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  // visor
  ctx.beginPath();
  ctx.ellipse(cx + 0.14 * s, by - 0.82 * s, 0.3 * s, 0.17 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#95cadc';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + 0.22 * s, by - 0.88 * s, 0.12 * s, 0.05 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

export default {
  id: 'scan',
  title: 'Submit Scan',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const p = api.data.player || { name: 'Crewmate', color: '#c51111', shadow: '#7a0838' };
    const r = () => Math.floor(api.rng() * 10);
    const lines = [
      `ID: ${p.name.toUpperCase().slice(0, 8)}-${r()}${r()}${r()}`,
      `HT: 3' ${6 + (r() % 4)}"`,
      `WT: ${88 + r() * 3} LB`,
      p.colorName && `COLOR: ${p.colorName.toUpperCase()}`,
      `BT: ${['O', 'A', 'B', 'AB'][r() % 4]}${r() % 2 ? '+' : '-'}`,
    ].filter(Boolean);
    let t = 0;
    let done = false;
    api.act({ type: 'visual', on: true });

    api.loop((dt) => {
      t += dt;
      const k = Math.min(1, t / TIMING.scan);
      if (k >= 1 && !done) {
        done = true;
        api.complete();
      }

      panel(ctx, w, h, '#7d8894');
      screen(ctx, 24, 24, 452, 452, 14);
      // grid lines on the scanner display
      ctx.strokeStyle = 'rgba(80,220,140,0.12)';
      ctx.lineWidth = 2;
      for (let gx = 44; gx < 470; gx += 30) {
        ctx.beginPath();
        ctx.moveTo(gx, 34);
        ctx.lineTo(gx, 466);
        ctx.stroke();
      }
      bean(ctx, 160, 390, 180, p.color, p.shadow);

      // scanning bar sweeps up and down over the figure
      const by = 390 - (Math.sin(t * 2.4) * 0.5 + 0.5) * 250;
      const g = ctx.createLinearGradient(0, by - 30, 0, by + 30);
      g.addColorStop(0, 'rgba(61,220,90,0)');
      g.addColorStop(0.5, 'rgba(61,220,90,0.55)');
      g.addColorStop(1, 'rgba(61,220,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(40, by - 30, 220, 60);
      ctx.fillStyle = '#7dff8a';
      ctx.fillRect(40, by - 2, 220, 4);

      const shown = Math.floor(k * (lines.length + 0.5));
      lines.forEach((ln, i) => {
        if (i < shown) text(ctx, ln, 285, 90 + i * 44, { size: 22, color: '#7dff8a', stroke: null, weight: 700, align: 'left' });
      });

      text(ctx, done ? 'SCAN COMPLETE' : 'SCANNING...', 370, 360, { size: 22, color: '#7dff8a', stroke: null, weight: 700 });
      box(ctx, 280, 390, 180, 30, 8, '#10201a', '#7dff8a', 3);
      ctx.fillStyle = '#3ddc5a';
      ctx.fillRect(284, 394, 172 * k, 22);
      text(ctx, `${Math.ceil(TIMING.scan * (1 - k))}s`, 370, 445, { size: 20, color: '#7dff8a', stroke: null, weight: 700 });
    });

    return () => {
      api.act({ type: 'visual', on: false });
      v.destroy();
    };
  },
};
