// Oxygen Depleted: type today's code from the sticky note into the keypad.
import { makeCanvas, panel, box, screen, text, inRect, PALETTE } from '../kit.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', '0', '✓'];
const MONO = '"Courier New", ui-monospace, monospace';

export default {
  id: 'o2',
  title: 'Oxygen Depleted',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const code = String(api.data.code ?? '00000');
    const keys = KEYS.map((k, i) => ({ k, x: 175 + (i % 3) * 100, y: 140 + Math.floor(i / 3) * 86, w: 88, h: 74 }));
    let entry = '';
    let flash = 0;
    let pressed = null;
    let pressT = 0;
    let done = false;
    let t = 0;

    v.onDown((x, y) => {
      if (done) return;
      const key = keys.find((b) => inRect(x, y, b));
      if (!key) return;
      pressed = key.k;
      pressT = 0.12;
      if (key.k === 'X') {
        entry = '';
        api.sfx('click');
      } else if (key.k === '✓') {
        if (entry === code) {
          done = true;
          api.sfx('good');
          api.act({ type: 'o2' });
          api.complete();
        } else {
          api.sfx('bad');
          flash = 0.6;
          entry = '';
        }
      } else if (entry.length < code.length) {
        entry += key.k;
        api.sfx('beep');
      }
    });

    api.loop((dt) => {
      t += dt;
      flash = Math.max(0, flash - dt);
      pressT = Math.max(0, pressT - dt);
      panel(ctx, w, h, '#8a96a3');

      screen(ctx, 175, 40, 288, 80, 10);
      if (flash > 0 && Math.floor(flash * 10) % 2 === 0) box(ctx, 175, 40, 288, 80, 10, 'rgba(224,55,47,0.75)', PALETTE.ink, 5);
      const shown = entry.padEnd(code.length, '_').split('').join(' ');
      text(ctx, shown, 319, 82, { size: 40, color: done ? PALETTE.green : PALETTE.cyan, stroke: null, font: MONO });

      keys.forEach((b) => {
        const down = pressT > 0 && pressed === b.k;
        const fill = b.k === '✓' ? '#4fbf5a' : b.k === 'X' ? '#d9534a' : '#dfe5ea';
        box(ctx, b.x, b.y + (down ? 4 : 0), b.w, b.h - 4, 12, '#4a535c');
        box(ctx, b.x, b.y + (down ? 4 : 0), b.w, b.h - (down ? 8 : 12), 12, fill);
        text(ctx, b.k, b.x + b.w / 2, b.y + b.h / 2 - (down ? 0 : 4), {
          size: 34,
          color: b.k === '✓' || b.k === 'X' ? PALETTE.white : PALETTE.ink,
          stroke: b.k === '✓' || b.k === 'X' ? PALETTE.ink : null,
        });
      });

      // Sticky note with today's code.
      ctx.save();
      ctx.translate(92, 108);
      ctx.rotate(-0.07);
      box(ctx, -70, -64, 140, 128, 4, '#f7e26b', PALETTE.ink, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(-66, -60, 132, 18);
      text(ctx, "today's code:", 0, -24, { size: 18, color: PALETTE.ink, stroke: null, weight: 700 });
      text(ctx, code, 0, 22, { size: 34, color: '#1d3fa8', stroke: null, font: MONO });
      ctx.restore();

      // O2 gauge, pulsing while depleted.
      const pulse = done ? 1 : 0.55 + 0.45 * Math.sin(t * 6);
      ctx.beginPath();
      ctx.arc(92, 330, 54, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#2a6b3a' : `rgba(224,55,47,${pulse})`;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      text(ctx, 'O₂', 92, 322, { size: 40 });
      text(ctx, done ? 'OK' : 'LOW', 92, 356, { size: 18 });
    });

    return () => v.destroy();
  },
};
