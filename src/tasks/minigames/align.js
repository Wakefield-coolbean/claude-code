// Align Engine Output: drag the lever along the track until the output sits on the center line.
import { makeCanvas, panel, screen, text, dist, clamp, PALETTE } from '../kit.js';

export default {
  id: 'align',
  title: 'Align Engine Output',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const cx = 110;
    const cy = 250;
    const R = 330;
    const MAX = 0.55;
    let theta = (api.rng() < 0.5 ? -1 : 1) * (0.2 + api.rng() * 0.3);
    let dragging = false;
    let done = false;
    const offset = () => R * Math.sin(theta);
    const aligned = () => Math.abs(offset()) < 6;
    const handle = () => ({ x: cx + R * Math.cos(theta), y: cy + R * Math.sin(theta) });

    v.onDown((x, y) => {
      const p = handle();
      if (done || dist(x, y, p.x, p.y) > 55) return;
      dragging = true;
      api.sfx('click');
    });
    v.onMove((x, y) => {
      if (dragging) theta = clamp(Math.atan2(y - cy, x - cx), -MAX, MAX);
    });
    v.onUp(() => {
      if (!dragging) return;
      dragging = false;
      if (aligned()) {
        theta = 0;
        done = true;
        api.sfx('good');
        api.complete();
      } else {
        api.sfx('drag');
      }
    });

    api.loop(() => {
      panel(ctx, w, h, '#86909b');
      screen(ctx, 30, 40, 380, 420, 14);
      ctx.save();
      ctx.beginPath();
      ctx.rect(36, 46, 368, 408);
      ctx.clip();
      // Center line.
      ctx.setLineDash([14, 10]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(242,246,248,0.6)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(410, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      // Engine output beam.
      const ok = aligned();
      ctx.lineCap = 'round';
      ctx.lineWidth = 16;
      ctx.strokeStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (R - 30) * Math.cos(theta), cy + (R - 30) * Math.sin(theta));
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.strokeStyle = ok ? PALETTE.green : PALETTE.yellow;
      ctx.stroke();
      ctx.restore();

      // Engine nozzle.
      for (const [r, c] of [
        [58, '#4b545e'],
        [44, '#9aa6b2'],
        [28, '#2a3138'],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
      }

      // Curved track and lever.
      ctx.lineCap = 'round';
      ctx.lineWidth = 30;
      ctx.strokeStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -MAX - 0.04, MAX + 0.04);
      ctx.stroke();
      ctx.lineWidth = 20;
      ctx.strokeStyle = '#5b6672';
      ctx.stroke();
      const p = handle();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(theta);
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(4, -24);
      ctx.lineTo(28, -24);
      ctx.lineTo(28, 24);
      ctx.lineTo(4, 24);
      ctx.closePath();
      ctx.fillStyle = ok ? PALETTE.green : '#e8ecef';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.restore();

      const off = Math.round(offset());
      text(ctx, ok ? 'ALIGNED' : `OFFSET ${off > 0 ? '+' : ''}${off}`, 220, 430, { size: 22, color: ok ? PALETTE.green : PALETTE.white });
    });

    return () => v.destroy();
  },
};
