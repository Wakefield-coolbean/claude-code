// Fuel Engines: hold the button until the gauge is full. 'fill' fills the gas can, 'empty' pours it into the engine.
import { makeCanvas, panel, box, screen, text, led, PALETTE, dist } from '../kit.js';

const FILL_TIME = 3;
const BTN = { x: 390, y: 380, r: 52 };

export default {
  id: 'fuel',
  title: 'Fuel Engines',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const fill = api.data.mode !== 'empty';
    let level = 0;
    let holding = false;
    let tick = 0;
    let done = false;

    v.onDown((x, y) => {
      if (!done && dist(x, y, BTN.x, BTN.y) < BTN.r + 6) {
        holding = true;
        api.sfx('click');
      }
    });
    v.onUp(() => (holding = false));

    function gauge(x, y, gw, gh, color) {
      screen(ctx, x, y, gw, gh, 10);
      const fh = (gh - 16) * level;
      ctx.fillStyle = color;
      ctx.fillRect(x + 8, y + gh - 8 - fh, gw - 16, fh);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 8, y + gh - 8 - fh, 8, fh);
      for (let i = 1; i < 5; i++) {
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(x + gw - 22, y + (gh * i) / 5, 14, 3);
      }
    }

    function gasCan() {
      // jerry can body with a window showing the fuel inside
      box(ctx, 70, 120, 240, 320, 26, '#c8321f');
      box(ctx, 110, 80, 90, 50, 12, '#a02716');
      box(ctx, 230, 70, 40, 60, 8, '#5b6672');
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(90, 160);
      ctx.lineTo(290, 400);
      ctx.moveTo(290, 160);
      ctx.lineTo(90, 400);
      ctx.stroke();
      gauge(150, 170, 80, 230, '#f5c20a');
    }

    function engineTank() {
      box(ctx, 50, 60, 280, 400, 30, '#5b6672');
      for (let i = 0; i < 5; i++) box(ctx, 50, 100 + i * 72, 280, 16, 4, '#46505b', PALETTE.ink, 3);
      box(ctx, 130, 30, 120, 40, 8, '#8a96a3');
      gauge(140, 110, 100, 320, '#f5c20a');
      text(ctx, 'ENGINE', 190, 450, { size: 22 });
    }

    api.loop((dt) => {
      if (holding && !done) {
        level = Math.min(1, level + dt / FILL_TIME);
        tick += dt;
        if (tick > 0.25) {
          tick = 0;
          api.sfx('drag');
        }
        if (level >= 1) {
          done = true;
          holding = false;
          api.complete();
        }
      }

      panel(ctx, w, h, '#7d8894');
      if (fill) gasCan();
      else engineTank();

      box(ctx, 340, 80, 110, 220, 14, '#46505b');
      text(ctx, fill ? 'FILL' : 'FUEL', 395, 110, { size: 24 });
      led(ctx, 395, 170, 20, !done, PALETTE.red, '#4a1d1d');
      led(ctx, 395, 240, 20, done, PALETTE.green, '#1d3a22');

      box(ctx, BTN.x - BTN.r - 12, BTN.y - BTN.r - 12, (BTN.r + 12) * 2, (BTN.r + 12) * 2, 18, '#46505b');
      ctx.beginPath();
      ctx.arc(BTN.x, BTN.y + (holding ? 4 : 0), BTN.r, 0, Math.PI * 2);
      ctx.fillStyle = holding ? '#2c9a3c' : PALETTE.green;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      text(ctx, 'HOLD', BTN.x, BTN.y + (holding ? 4 : 0), { size: 24 });
    });

    return () => v.destroy();
  },
};
