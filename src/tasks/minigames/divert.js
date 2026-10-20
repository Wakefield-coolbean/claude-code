// Divert Power: in Electrical, slide the blinking room's lever up; then accept the power in that room.
import { makeCanvas, panel, box, screen, text, led, clamp, dist, PALETTE } from '../kit.js';

const ROOMS = ['Weapons', 'Bridge', 'O2', 'Shields', 'Comms', 'Security', 'Port Engine', 'Starboard Engine'];
const short = (n) => n.toUpperCase().replace('STARBOARD', 'STBD').replace('ENGINE', 'ENG');

function mountDivert(root, api, room) {
  const v = makeCanvas(root, 500, 500);
  const { ctx, w, h } = v;
  const names = ROOMS.includes(room) ? ROOMS : [...ROOMS.slice(0, 7), room];
  const target = names.indexOf(room);
  const TOP = 120;
  const BOTTOM = 330;
  const cols = names.map((name, i) => ({ name, x: 62 + i * 54, y: BOTTOM, shake: 0 }));
  let dragging = false;
  let done = false;

  v.onDown((x, y) => {
    const i = cols.findIndex((c) => Math.abs(x - c.x) < 24 && Math.abs(y - c.y) < 26);
    if (i < 0 || done) return;
    if (i === target) {
      dragging = true;
      api.sfx('click');
    } else {
      cols[i].shake = 0.3;
      api.sfx('bad');
    }
  });
  v.onMove((x, y) => {
    if (!dragging) return;
    const c = cols[target];
    c.y = clamp(y, TOP, BOTTOM);
    if (c.y <= TOP + 4) {
      c.y = TOP;
      done = true;
      dragging = false;
      api.sfx('good');
      api.complete();
    }
  });
  v.onUp(() => (dragging = false));

  api.loop((dt, t) => {
    panel(ctx, w, h);
    screen(ctx, 30, 40, 440, 48, 10);
    text(ctx, done ? `POWER → ${room.toUpperCase()}` : 'DIVERT POWER', 250, 65, { size: 22, color: done ? PALETTE.green : PALETTE.yellow });
    cols.forEach((c, i) => {
      c.shake = Math.max(0, c.shake - dt);
      const x = c.x + Math.sin(t * 70) * 4 * (c.shake / 0.3);
      const isTarget = i === target;
      led(ctx, x, 104, 7, isTarget && (done || Math.sin(t * 9) > 0), done ? PALETTE.green : PALETTE.yellow);
      box(ctx, x - 7, TOP - 10, 14, BOTTOM - TOP + 20, 7, '#11161a', PALETTE.ink, 3);
      if (isTarget && c.y < BOTTOM) {
        ctx.fillStyle = PALETTE.yellow;
        ctx.fillRect(x - 3, c.y, 6, BOTTOM - c.y + 8);
      }
      box(ctx, x - 21, c.y - 14, 42, 28, 6, isTarget ? PALETTE.metalLight : PALETTE.metal, PALETTE.ink, 4);
      ctx.strokeStyle = PALETTE.metalDark;
      ctx.lineWidth = 2;
      for (const d of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.moveTo(x - 12, c.y + d);
        ctx.lineTo(x + 12, c.y + d);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(x + 5, 480);
      ctx.rotate(-Math.PI / 2);
      text(ctx, short(c.name), 0, 0, { size: 15, align: 'left', color: isTarget ? PALETTE.yellow : PALETTE.white });
      ctx.restore();
    });
  });
  return () => v.destroy();
}

function mountAccept(root, api, room) {
  const v = makeCanvas(root, 500, 500);
  const { ctx, w, h } = v;
  const C = { x: 250, y: 300 };
  let angle = -Math.PI / 2;
  let turning = false;
  let finishIn = -1;
  const sparks = [];

  v.onDown((x, y) => {
    if (!turning && dist(x, y, C.x, C.y) < 100) {
      turning = true;
      api.sfx('click');
    }
  });

  api.loop((dt) => {
    if (turning && angle < 0) {
      angle = Math.min(0, angle + dt * 6);
      if (angle === 0) {
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 120 + Math.random() * 220;
          sparks.push({ x: C.x, y: C.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.3 });
        }
        api.sfx('good');
        finishIn = 0.5;
      }
    }
    if (finishIn > 0) {
      finishIn -= dt;
      if (finishIn <= 0) api.complete();
    }
    panel(ctx, w, h);
    screen(ctx, 40, 40, 420, 96, 12);
    text(ctx, 'ACCEPT DIVERTED POWER', 250, 76, { size: 26, color: PALETTE.yellow });
    text(ctx, room.toUpperCase(), 250, 112, { size: 18 });
    // cable lights up once switched on
    ctx.lineWidth = 14;
    ctx.strokeStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.moveTo(C.x, 136);
    ctx.lineTo(C.x, C.y - 100);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = angle === 0 ? PALETTE.yellow : '#4a4030';
    ctx.stroke();
    // switch body
    ctx.beginPath();
    ctx.arc(C.x, C.y, 100, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.metalDark;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke();
    text(ctx, 'OFF', C.x - 52, C.y - 124, { size: 18, color: angle < 0 ? PALETTE.red : PALETTE.white });
    text(ctx, 'ON', C.x + 130, C.y, { size: 18, color: angle === 0 ? PALETTE.green : PALETTE.white });
    ctx.save();
    ctx.translate(C.x, C.y);
    ctx.rotate(angle);
    box(ctx, -22, -22, 112, 44, 20, angle === 0 ? PALETTE.yellow : PALETTE.metalLight, PALETTE.ink, 6);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(C.x, C.y, 30, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.metal;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke();
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 500 * dt;
      ctx.strokeStyle = PALETTE.yellow;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.04, s.y - s.vy * 0.04);
      ctx.stroke();
    }
    if (!turning) text(ctx, 'Tap the switch', 250, 460, { size: 18 });
  });
  return () => v.destroy();
}

export default {
  id: 'divert',
  title: 'Divert Power',
  mount(root, api) {
    const room = api.data.room || 'Weapons';
    return api.data.mode === 'accept' ? mountAccept(root, api, room) : mountDivert(root, api, room);
  },
};
