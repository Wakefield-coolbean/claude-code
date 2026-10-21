// In-world animations layered over the game state: the killer's lunge, the victim's death,
// vent drops and pops, a new ghost rising, doors sliding. Purely visual: each screen runs its
// own from the game's events, so they work the same in freeplay and online.

import { DIST } from './config.js';
import { walkPose, drawTopHalf, CUT_Y } from './sprites.js';
import { KILL_SCENE } from './cutscenes.js';

const K = DIST.char;
const LUNGE = 0.17; // s
const DEATH = 0.8;
const BODY_HIDDEN = 0.12; // the victim stands whole for a beat before falling apart
const BODY_DROP = 0.3;
const VENT_IN = 0.42;
const VENT_OUT = 0.42;
const RISE = 1.5;
const DOOR = 0.24;
const INK = '#07090c';
const BLOOD = '#c3141d';

const clamp01 = (u) => Math.max(0, Math.min(1, u));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u;
const now = () => performance.now() / 1000;

export class WorldFx {
  constructor(renderer) {
    this.r = renderer;
    this.game = null;
    this.offs = [];
    this.list = [];
    this.doors = new Map(); // door id -> { closed, t }
  }

  setGame(game) {
    if (game === this.game) return;
    this.offs.forEach((off) => off());
    this.offs = [];
    this.list = [];
    this.doors.clear();
    this.game = game;
    if (!game) return;
    this.offs.push(
      game.on('kill', (e) => this.onKill(e)),
      game.on('vent', (e) => this.onVent(e)),
      game.on('meeting', () => (this.list = this.list.filter((f) => f.kind === 'rise'))),
    );
  }

  onKill({ killer, victim, body, from }) {
    const t = now();
    const to = { x: body.x, y: body.y };
    if (from && Math.hypot(from.x - to.x, from.y - to.y) > 0.05) {
      this.list.push({ kind: 'lunge', p: killer, t0: t, end: t + LUNGE + 0.08, from: { x: from.x, y: from.y }, to });
    }
    const dir = from ? (from.x <= to.x ? 1 : -1) : -victim.facing;
    this.list.push({ kind: 'death', p: victim, bodyId: body.id, t0: t, end: t + DEATH, x: to.x, y: to.y, dir, facing: victim.facing });
    // Your own ghost rises out of the body once the cutscene ends.
    if (victim === this.game.local)
      this.list.push({ kind: 'rise', p: victim, t0: t + KILL_SCENE, end: t + KILL_SCENE + RISE, x: to.x, y: to.y });
  }

  onVent({ player, vent, enter }) {
    const v = this.game.map.vents[vent];
    if (!v) return;
    const t = now();
    this.list = this.list.filter((f) => !(f.p === player && (f.kind === 'ventIn' || f.kind === 'ventOut')));
    this.list.push({
      kind: enter ? 'ventIn' : 'ventOut',
      p: player,
      t0: t,
      end: t + (enter ? VENT_IN : VENT_OUT),
      x: v.x,
      y: v.y,
      facing: player.facing,
    });
  }

  /** Drop finished effects; call once per frame. */
  tick(time) {
    if (this.list.length) this.list = this.list.filter((f) => time < f.end);
  }

  find(kind, p, time) {
    return this.list.find((f) => f.kind === kind && f.p === p && time >= f.t0 && time < f.end);
  }

  /** Draw position of a player mid-lunge, or null. */
  pos(p, time) {
    const f = this.find('lunge', p, time);
    if (!f) return null;
    const u = easeOut(seg(time, f.t0, f.t0 + LUNGE));
    return [f.from.x + (f.to.x - f.from.x) * u, f.from.y + (f.to.y - f.from.y) * u];
  }

  /** Is a stand-in drawing this player right now (hide the normal sprite)? */
  hidesPlayer(p, time) {
    return this.list.some(
      (f) =>
        f.p === p &&
        time < f.end &&
        (f.kind === 'ventOut' || f.kind === 'lunge' || (f.kind === 'death' && !p.alive) || (f.kind === 'rise' && time < f.t0)),
    );
  }

  /** Is the death animation still standing in for this body? */
  hidesBody(b, time) {
    return this.list.some((f) => f.kind === 'death' && f.bodyId === b.id && time < f.t0 + BODY_HIDDEN + BODY_DROP);
  }

  /** A rising ghost: extra lift (cells, up is negative) and opacity, or null. */
  ghostRise(p, time) {
    const f = this.list.find((x) => x.kind === 'rise' && x.p === p && time >= x.t0 && time < x.end);
    if (!f) return null;
    const u = seg(time, f.t0, f.end);
    return { dy: (1 - easeOut(u)) * 0.9, alpha: Math.min(1, u * 2.5) };
  }

  /**
   * Door slide: 0 open .. 1 shut, easing toward the door's real state. New doors start settled.
   */
  doorK(d, closed, time) {
    let s = this.doors.get(d.id);
    if (!s) this.doors.set(d.id, (s = { closed, t: -1e9 }));
    if (s.closed !== !!closed) {
      // Reverse from wherever the slide is now.
      const k = this.doorK(d, s.closed, time);
      s.closed = !!closed;
      s.t = time - (s.closed ? k : 1 - k) * DOOR;
    }
    const u = easeOut(seg(time, s.t, s.t + DOOR));
    return s.closed ? u : 1 - u;
  }

  /** Y-sorted draw items for the effects; visible(x, y) says whether the viewer can see a spot. */
  items(ctx, time, visible) {
    const out = [];
    for (const f of this.list) {
      if (time < f.t0 || time >= f.end) continue;
      const t = time - f.t0;
      if (f.kind === 'lunge') {
        const [x, y] = this.pos(f.p, time) || [f.to.x, f.to.y];
        if (!visible(x, y - 0.55) && !visible(f.to.x, f.to.y - 0.55)) continue;
        out.push({ y, draw: () => this.drawLunge(ctx, f, x, y, t) });
      } else if (f.kind === 'death') {
        if (!visible(f.x, f.y - 0.4)) continue;
        out.push({ y: f.y, draw: () => this.drawDeath(ctx, f, t) });
      } else if (f.kind === 'ventIn' || f.kind === 'ventOut') {
        if (!visible(f.x, f.y - 0.3)) continue;
        out.push({ y: f.y, draw: () => this.drawVent(ctx, f, t) });
      }
    }
    return out;
  }

  // ---------- drawing ----------

  /**
   * A full-outfit stand-in for player p with its feet at world (x, y), through the sprite cache.
   * o: frame, sx/sy squash about the feet, rot, dy (cells), clipY (world y below which nothing shows).
   */
  standIn(ctx, p, x, y, o = {}) {
    const r = this.r;
    const [sx, sy] = r.screenPos(ctx, x, y + (o.dy || 0));
    const clip = o.clipY != null ? r.screenPos(ctx, x, o.clipY)[1] : null;
    const facing = o.facing ?? p.facing;
    const frame = o.frame ?? -1;
    const pose = walkPose(frame);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clip != null) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, clip + 1e5);
      ctx.clip();
    }
    ctx.translate(sx, sy);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.sx ?? 1, o.sy ?? 1);
    const back = r.sprites.hat(p.outfit?.hat, 'back');
    if (back) r.sprites.blit(ctx, back, 0, 0, facing, r.ppc, 1, pose);
    r.sprites.blit(ctx, r.sprites.crewmate(p, frame, false), 0, 0, facing, r.ppc);
    r.sprites.visor(ctx, 0, 0, facing, r.ppc, 1, 0, frame, p.outfit?.visor);
    const front = r.sprites.hat(p.outfit?.hat, 'front');
    if (front) r.sprites.blit(ctx, front, 0, 0, facing, r.ppc, 1, pose);
    ctx.restore();
  }

  shadow(ctx, x, y, w = 0.48, a = 0.25) {
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w, w / 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLunge(ctx, f, x, y, t) {
    const u = seg(t, 0, LUNGE);
    const land = Math.sin(Math.PI * seg(t, LUNGE, LUNGE + 0.08));
    const facing = f.to.x >= f.from.x ? 1 : -1;
    // Smear behind the dash.
    if (u < 1) {
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - u);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.12;
      for (const dy of [-0.35, -0.75, -1.1]) {
        ctx.beginPath();
        ctx.moveTo(f.from.x + (x - f.from.x) * 0.3, f.from.y + dy);
        ctx.lineTo(x - facing * 0.4, y + dy);
        ctx.stroke();
      }
      ctx.restore();
    }
    this.shadow(ctx, x, y);
    this.standIn(ctx, f.p, x, y, {
      facing,
      frame: u < 1 ? 3 : -1,
      sx: u < 1 ? 1.12 : 1 + land * 0.12,
      sy: u < 1 ? 0.9 : 1 - land * 0.14,
      rot: u < 1 ? facing * 0.18 : 0,
    });
  }

  drawDeath(ctx, f, t) {
    const p = f.p;
    const r = this.r;
    if (t < BODY_HIDDEN) {
      // Struck: a whole crewmate, flinching.
      this.shadow(ctx, f.x, f.y);
      this.standIn(ctx, p, f.x, f.y, { facing: f.facing, sx: 1 - t * 0.8, sy: 1 + t * 0.6 });
      this.impact(ctx, f.x, f.y - 0.85 * K, t / BODY_HIDDEN);
      return;
    }
    const t2 = t - BODY_HIDDEN;
    // The lower half drops into place with a squash, then the real body takes over.
    if (t2 < BODY_DROP) {
      const u = t2 / BODY_DROP;
      const [sx, sy] = r.screenPos(ctx, f.x, f.y);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(sx, sy);
      ctx.scale(1 + Math.sin(u * Math.PI) * 0.18, 1 - Math.sin(u * Math.PI) * 0.22);
      r.sprites.blit(ctx, r.sprites.body(p, p.colorIndex, p.outfit?.skin), 0, 0, 1, r.ppc);
      ctx.restore();
    }
    // The top half pops off, tumbles away from the killer and fades.
    const u = seg(t2, 0, DEATH - BODY_HIDDEN);
    const cx = f.x + f.dir * 1.1 * easeOut(u);
    const lift = (1.3 * u - 1.9 * u * u) * K;
    const cy = Math.min(f.y - 0.3 * K, f.y + (CUT_Y - 0.3) * K - lift);
    const [px, py] = r.screenPos(ctx, cx, cy);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1 - easeIn(seg(u, 0.55, 1));
    ctx.translate(px, py);
    ctx.rotate(f.dir * u * 7);
    ctx.scale(f.facing * r.ppc * K, r.ppc * K);
    ctx.translate(0, 0.92);
    drawTopHalf(ctx, p);
    ctx.restore();
    this.splash(ctx, f.x, f.y + CUT_Y * K, seg(t2, 0, 0.6), p.id * 7 + 3, f.dir, f.y);
  }

  drawVent(ctx, f, t) {
    const p = f.p;
    const hole = f.y + 0.3; // near edge of the vent hole
    if (f.kind === 'ventIn') {
      // Crouch, hop, and drop through the grate.
      const crouch = Math.sin(Math.PI * seg(t, 0, 0.12));
      const hop = Math.sin(Math.PI * seg(t, 0.1, 0.24)) * 0.35;
      const drop = easeIn(seg(t, 0.22, VENT_IN)) * 1.9;
      if (t < 0.22) this.shadow(ctx, f.x, f.y, 0.48 * (1 - hop));
      this.standIn(ctx, p, f.x, f.y, {
        facing: f.facing,
        dy: drop - hop,
        sx: 1 + crouch * 0.18 - (t > 0.22 ? 0.12 : 0),
        sy: 1 - crouch * 0.25 + (t > 0.22 ? 0.15 : 0),
        clipY: t > 0.2 ? hole : null,
      });
    } else {
      // Spring up out of the grate, hang, land with a squash.
      const rise = 1 - easeOut(seg(t, 0, 0.16));
      const hop = Math.sin(Math.PI * seg(t, 0.12, 0.32)) * 0.4;
      const land = Math.sin(Math.PI * seg(t, 0.32, VENT_OUT));
      if (t > 0.12) this.shadow(ctx, f.x, f.y, 0.48 * (1 - hop * 0.5));
      this.standIn(ctx, p, f.x, f.y, {
        facing: f.facing,
        dy: rise * 1.9 - hop,
        sx: t < 0.16 ? 0.88 : 1 + land * 0.16,
        sy: t < 0.16 ? 1.15 : 1 - land * 0.2,
        clipY: t < 0.16 ? hole : null,
      });
    }
  }

  impact(ctx, x, y, u) {
    if (u <= 0 || u >= 1) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1 - u;
    const r = 0.35 + easeOut(u) * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }

  /** Droplets sprayed from (x, y), landing on the floor at floorY. */
  splash(ctx, x, y, u, seed, dir, floorY) {
    if (u <= 0 || u >= 1) return;
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    ctx.save();
    ctx.globalAlpha = 1 - u * u;
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = INK;
    ctx.fillStyle = BLOOD;
    for (let i = 0; i < 9; i++) {
      const vx = (rnd() - 0.3) * 1.8 * dir;
      const vy = -0.8 - rnd() * 1.2;
      const px = x + vx * u;
      const py = Math.min(floorY + 0.05, y + vy * u + 3.4 * u * u);
      const r = 0.04 + rnd() * 0.05;
      ctx.beginPath();
      if (py >= floorY + 0.05) ctx.ellipse(px, py, r * 1.7, r * 0.5, 0, 0, Math.PI * 2);
      else ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
