// Comms Sabotaged: turn the dial until the signal comes in clean, then hold it there.
import { makeCanvas, panel, screen, text, led, dist, clamp, PALETTE } from '../kit.js';

const TAU = Math.PI * 2;

export default {
  id: 'comms',
  title: 'Comms Sabotaged',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const target = typeof api.data.target === 'number' ? api.data.target : api.rng();
    const circ = (a, b) => {
      const d = Math.abs(a - b) % 1;
      return Math.min(d, 1 - d);
    };
    let value = (target + 0.3 + api.rng() * 0.4) % 1;
    const dial = { x: 250, y: 360, r: 92 };
    let drag = null; // { angle, value }
    let held = 0;
    let done = false;
    let t = 0;
    const angleAt = (x, y) => Math.atan2(y - dial.y, x - dial.x);

    v.onDown((x, y) => {
      if (done || dist(x, y, dial.x, dial.y) > dial.r + 20) return;
      drag = { angle: angleAt(x, y), value };
      api.sfx('click');
    });
    v.onMove((x, y) => {
      if (!drag) return;
      let da = angleAt(x, y) - drag.angle;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      value = (((drag.value + da / TAU) % 1) + 1) % 1;
      drag.value = value;
      drag.angle = angleAt(x, y);
    });
    v.onUp(() => (drag = null));

    api.loop((dt) => {
      t += dt;
      const d = circ(value, target);
      held = d < 0.03 ? held + dt : 0;
      const noise = clamp((d - 0.02) / 0.25, 0, 1);

      panel(ctx, w, h, '#7f8b98');
      screen(ctx, 40, 40, 420, 180, 12);
      ctx.save();
      ctx.beginPath();
      ctx.rect(46, 46, 408, 168);
      ctx.clip();
      ctx.strokeStyle = 'rgba(69,224,232,0.12)';
      ctx.lineWidth = 1;
      for (let gx = 60; gx < 460; gx += 30) {
        ctx.beginPath();
        ctx.moveTo(gx, 46);
        ctx.lineTo(gx, 214);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let x = 50; x <= 450; x += 3) {
        const y = 130 + 40 * Math.sin(x * 0.045 + t * 6) * (1 - noise * 0.6) + noise * (Math.random() * 2 - 1) * 70;
        if (x === 50) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = noise < 0.05 ? PALETTE.green : PALETTE.cyan;
      ctx.stroke();
      ctx.restore();
      text(ctx, `${(88 + value * 20).toFixed(1)} MHz`, 444, 196, { size: 18, align: 'right', color: PALETTE.white });

      // Signal strength LEDs.
      const bars = Math.round((1 - clamp(d / 0.3, 0, 1)) * 5);
      for (let i = 0; i < 5; i++) led(ctx, 70, 410 - i * 36, 11, i < bars, i < 4 ? PALETTE.green : PALETTE.yellow);
      text(ctx, done || held > 0 ? 'SIGNAL LOCKED' : 'TUNING...', 420, 270, {
        size: 18,
        color: held > 0 ? PALETTE.green : PALETTE.white,
        align: 'right',
      });

      // Dial.
      ctx.beginPath();
      ctx.arc(dial.x, dial.y, dial.r + 16, 0, TAU);
      ctx.fillStyle = '#5b6672';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        ctx.beginPath();
        ctx.moveTo(dial.x + Math.cos(a) * (dial.r + 4), dial.y + Math.sin(a) * (dial.r + 4));
        ctx.lineTo(dial.x + Math.cos(a) * (dial.r + 13), dial.y + Math.sin(a) * (dial.r + 13));
        ctx.lineWidth = 3;
        ctx.strokeStyle = PALETTE.metalLight;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(dial.x, dial.y, dial.r - 10, 0, TAU);
      ctx.fillStyle = '#c3ccd5';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      const a = value * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(dial.x, dial.y);
      ctx.lineTo(dial.x + Math.cos(a) * (dial.r - 22), dial.y + Math.sin(a) * (dial.r - 22));
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.strokeStyle = PALETTE.red;
      ctx.stroke();

      if (!done && held >= 1) {
        done = true;
        api.act({ type: 'comms' });
        api.complete();
      }
    });

    return () => v.destroy();
  },
};
