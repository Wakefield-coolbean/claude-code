// Download / Upload Data: press the button and wait for the files to transfer between folders.
import { makeCanvas, panel, box, screen, text, PALETTE, inRect } from '../kit.js';
import { TIMING } from '../../config.js';

const BTN = { x: 150, y: 370, w: 200, h: 70 };

function folder(ctx, x, y, label, open) {
  box(ctx, x, y + 10, 46, 20, 6, '#e0b23a', PALETTE.ink, 3);
  box(ctx, x, y + 20, 110, 76, 8, open ? '#f5cf55' : '#e0b23a', PALETTE.ink, 4);
  text(ctx, label, x + 55, y + 118, { size: 16, color: '#7dff8a', stroke: null, weight: 700 });
}

function fmtEta(sec, t) {
  // A silly estimate at first, like a real progress dialog, then an honest countdown.
  if (t < 0.6) return `${3 + Math.floor(t * 9)}d ${14 - Math.floor(t * 10)}hr ${42 + Math.floor(t * 20)}m 12s`;
  return `${Math.ceil(sec)}s`;
}

export default {
  id: 'data',
  title: 'Upload Data',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const upload = api.data.mode === 'upload';
    const room = api.data.room || 'Admin';
    const from = upload ? 'MY TABLET' : room.toUpperCase();
    const to = upload ? 'HEADQUARTERS' : 'MY TABLET';
    let running = false;
    let t = 0;
    let done = false;

    v.onDown((x, y) => {
      if (!running && inRect(x, y, BTN)) {
        running = true;
        api.sfx('click');
      }
    });

    api.loop((dt) => {
      if (running && !done) {
        t += dt;
        if (t >= TIMING.dataTransfer) {
          done = true;
          api.complete();
        }
      }
      const k = Math.min(1, t / TIMING.dataTransfer);

      panel(ctx, w, h, '#7d8894');
      screen(ctx, 24, 24, 452, 320, 14);
      folder(ctx, 52, 70, from, running);
      folder(ctx, 338, 70, to, running && !done);

      if (running && !done) {
        // pages hop from one folder to the other along an arc
        for (let i = 0; i < 3; i++) {
          const p = (t * 1.3 + i / 3) % 1;
          const px = 120 + p * 240;
          const py = 110 - Math.sin(p * Math.PI) * 60;
          box(ctx, px, py, 22, 28, 3, PALETTE.white, PALETTE.ink, 2);
        }
      }

      text(ctx, done ? 'COMPLETE' : running ? (upload ? 'UPLOADING...' : 'DOWNLOADING...') : 'READY', 250, 240, {
        size: 22,
        color: '#7dff8a',
        stroke: null,
        weight: 700,
      });
      box(ctx, 52, 260, 396, 30, 8, '#10201a', '#7dff8a', 3);
      ctx.fillStyle = '#3ddc5a';
      ctx.fillRect(56, 264, 388 * k, 22);
      if (running) {
        text(ctx, `Estimated Time: ${fmtEta(TIMING.dataTransfer - t, t)}`, 250, 315, {
          size: 18,
          color: '#7dff8a',
          stroke: null,
          weight: 600,
        });
      }

      if (!running) {
        box(ctx, BTN.x, BTN.y, BTN.w, BTN.h, 14, PALETTE.blue);
        text(ctx, upload ? 'Upload' : 'Download', BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, { size: 28 });
      } else {
        text(ctx, `${Math.floor(k * 100)}%`, 250, 405, { size: 36 });
      }
    });

    return () => v.destroy();
  },
};
