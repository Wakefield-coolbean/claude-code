// Full-screen moments: menu, role reveal, meeting splash, kill, ejection, game over, pause.

import { TIMING } from './config.js';
import { drawCrewmate, drawGhost, drawBody } from './sprites.js';
import { sfx, isMuted, setMuted } from './audio.js';
import { icon } from './hud.js';

/** Canvas with one character drawn at a CSS height of `size` px. */
export function bean(p, size = 64, { kind = 'alive', facing = 1, frame = -1 } = {}) {
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = size / 1.45; // px per cell so a 1.3-cell character fills `size`
  c.width = Math.ceil(1.6 * s * dpr);
  c.height = Math.ceil(1.5 * s * dpr);
  c.style.width = `${1.6 * s}px`;
  c.style.height = `${1.5 * s}px`;
  c.className = 'bean';
  const ctx = c.getContext('2d');
  ctx.scale(s * dpr, s * dpr);
  ctx.translate(0.8, 1.42);
  if (facing < 0) ctx.scale(-1, 1);
  if (kind === 'ghost') drawGhost(ctx, p.color, p.shadow, 0);
  else if (kind === 'body') drawBody(ctx, p.color, p.shadow);
  else drawCrewmate(ctx, p.color, p.shadow, frame);
  return c;
}

/** Animated starfield behind a screen. dir: drift direction in px/s. */
export class Starfield {
  constructor(host, { speed = 30, dense = 1 } = {}) {
    this.c = document.createElement('canvas');
    this.c.className = 'stars';
    host.prepend(this.c);
    this.speed = speed;
    this.stars = Array.from({ length: Math.round(160 * dense) }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
    }));
    this.last = performance.now();
    this.alive = true;
    const loop = (t) => {
      if (!this.alive) return;
      this.draw((t - this.last) / 1000);
      this.last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  draw(dt) {
    const c = this.c;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of this.stars) {
      s.x -= (this.speed * s.z * Math.min(dt, 0.05)) / w;
      if (s.x < 0) s.x += 1;
      ctx.fillStyle = `rgba(220,230,255,${0.3 + s.z * 0.7})`;
      const r = s.z * 1.6;
      ctx.fillRect(s.x * w, s.y * h, r, r);
    }
  }

  stop() {
    this.alive = false;
    this.c.remove();
  }
}

const REASONS = {
  tasks: 'The crew finished every task.',
  vote: 'Every Impostor was ejected.',
  kills: 'The Impostors outnumbered the crew.',
  sabotage: 'The crew failed to stop the sabotage.',
};

export class Screens {
  constructor(root) {
    this.root = root;
    this.stars = null;
    this.timers = [];
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stars?.stop();
    this.stars = null;
    this.root.innerHTML = '';
    this.root.className = 'screen';
    this.root.hidden = true;
  }

  open(cls, html, stars) {
    this.clear();
    this.root.hidden = false;
    this.root.className = `screen ${cls}`;
    this.root.innerHTML = html;
    if (stars) this.stars = new Starfield(this.root, stars);
  }

  later(ms, fn) {
    this.timers.push(setTimeout(fn, ms));
  }

  // ---------- intro ----------
  intro(game, done) {
    const me = game.local;
    this.open('shh', `<div class="shh-art"></div><p class="shh-text">Shhhhh!</p>`);
    this.root.querySelector('.shh-art').appendChild(bean(me, 220));
    sfx('shh');
    this.later(TIMING.shhh * 1000, () => {
      const imp = me.role === 'impostor';
      const n = game.players.filter((p) => p.role === 'impostor').length;
      const team = imp ? game.players.filter((p) => p.role === 'impostor') : game.players;
      const sub = imp
        ? n > 1
          ? 'Work with your fellow Impostors.'
          : 'Eliminate the crew.'
        : `There ${n === 1 ? 'is' : 'are'} <b>${n} Impostor${n === 1 ? '' : 's'}</b> among the crew`;
      this.open(
        `reveal ${imp ? 'imp' : 'crew'}`,
        `<h1 class="role-title">${imp ? 'Impostor' : 'Crewmate'}</h1><p class="role-sub">${sub}</p><div class="lineup"></div>`,
      );
      const line = this.root.querySelector('.lineup');
      const order = [me, ...team.filter((p) => p !== me)];
      order.forEach((p, i) => {
        const wrap = document.createElement('div');
        const rank = Math.ceil(i / 2);
        wrap.className = 'lineup-item';
        wrap.style.order = String(i % 2 ? 50 - rank : 50 + rank);
        wrap.style.setProperty('--k', String(1 - rank * 0.1));
        wrap.style.zIndex = String(20 - rank);
        wrap.appendChild(bean(p, 130 * (1 - rank * 0.1), { facing: i % 2 ? 1 : -1 }));
        const name = document.createElement('span');
        name.textContent = p.name;
        if (imp) name.className = 'imp';
        wrap.appendChild(name);
        line.appendChild(wrap);
      });
      sfx(imp ? 'roleImp' : 'roleCrew');
      this.later(TIMING.roleReveal * 1000, () => {
        this.clear();
        done();
      });
    });
  }

  // ---------- meeting splash ----------
  meetingSplash(game, { meeting, caller }) {
    const body = meeting.reason === 'body';
    this.open(
      `splash ${body ? 'body' : 'emergency'}`,
      `<div class="burst" aria-hidden="true"></div><div class="splash-art"></div><h1>${body ? 'Dead Body Reported' : 'Emergency Meeting!'}</h1>`,
    );
    const art = this.root.querySelector('.splash-art');
    if (body) {
      const victim = game.players[meeting.bodyId];
      art.appendChild(bean(victim, 150, { kind: 'body' }));
    } else {
      art.appendChild(bean(caller, 170));
    }
    sfx(body ? 'report' : 'emergency');
  }

  // ---------- kill (seen by the victim) ----------
  killed(killer, victim, done) {
    this.open('kill', `<div class="kill-stage"><div class="killer"></div><div class="victim"></div></div>`);
    this.root.querySelector('.killer').appendChild(bean(killer, 170));
    const v = this.root.querySelector('.victim');
    v.appendChild(bean(victim, 170, { facing: -1 }));
    sfx('kill');
    this.later(650, () => {
      v.innerHTML = '';
      v.appendChild(bean(victim, 170, { kind: 'body', facing: -1 }));
      this.root.classList.add('hit');
    });
    this.later(TIMING.killAnimation * 1000, () => {
      this.clear();
      done();
    });
  }

  // ---------- ejection ----------
  ejection(game, ej, done) {
    this.open('eject', `<div class="eject-body"></div><p class="eject-text"><span class="l1"></span><span class="l2"></span></p>`, {
      speed: 60,
      dense: 1.4,
    });
    if (ej.player) {
      const b = this.root.querySelector('.eject-body');
      b.appendChild(bean(ej.player, 110));
      b.classList.add('go');
    }
    sfx('eject');
    const l1 = this.root.querySelector('.l1');
    const l2 = this.root.querySelector('.l2');
    let i = 0;
    const type = () => {
      if (i < ej.line1.length) {
        l1.textContent = ej.line1.slice(0, ++i);
        if (i % 2) sfx('type');
        this.later(55, type);
      } else {
        this.later(500, () => (l2.textContent = ej.line2));
      }
    };
    this.later(1500, type);
    this.later(TIMING.ejection * 1000, () => {
      this.clear();
      done?.();
    });
  }

  // ---------- game over ----------
  gameOver(game, result, { onAgain, onMenu }) {
    const me = game.local;
    const won = me ? (result.winner === 'impostor') === (me.role === 'impostor') : true;
    const winners = game.players.filter((p) => (result.winner === 'impostor') === (p.role === 'impostor'));
    const title = won ? 'Victory' : 'Defeat';
    const side = result.winner === 'impostor' ? 'Impostors win' : 'Crewmates win';
    this.open(
      `over ${won ? 'won' : 'lost'} ${result.winner}`,
      `<h1 class="over-title">${title}</h1><p class="over-sub">${side}. ${REASONS[result.reason] || ''}</p>
       <div class="lineup winners"></div>
       <div class="over-actions"><button class="big-btn" id="again" type="button">Play again</button><button class="big-btn ghost" id="menu" type="button">Quit</button></div>`,
    );
    const line = this.root.querySelector('.winners');
    winners.forEach((p) => {
      const wrap = document.createElement('div');
      wrap.className = 'lineup-item';
      wrap.appendChild(bean(p, 96, { kind: p.alive ? 'alive' : 'ghost' }));
      const name = document.createElement('span');
      name.textContent = p.name;
      wrap.appendChild(name);
      line.appendChild(wrap);
    });
    sfx(won ? 'victory' : 'defeat');
    this.root.querySelector('#again').addEventListener('click', onAgain);
    this.root.querySelector('#menu').addEventListener('click', onMenu);
  }

  // ---------- pause ----------
  pause({ onResume, onQuit, onLobby }) {
    this.open(
      'pause',
      `<div class="card pause-card">
        <h2>Paused</h2>
        <button class="big-btn" id="resume" type="button">Resume</button>
        <button class="big-btn ghost" id="sound" type="button">${icon(isMuted() ? 'mute' : 'sound')}<span>${isMuted() ? 'Sound off' : 'Sound on'}</span></button>
        ${onLobby ? '<button class="big-btn ghost" id="lobby" type="button">Back to lobby</button>' : ''}
        <button class="big-btn ghost" id="quit" type="button">Quit to menu</button>
        <p class="hint">WASD / arrows move · E use · R report · Q kill · V vent · F sabotage · Tab map · Esc close</p>
      </div>`,
    );
    this.root.querySelector('#resume').addEventListener('click', onResume);
    this.root.querySelector('#quit').addEventListener('click', onQuit);
    this.root.querySelector('#lobby')?.addEventListener('click', onLobby);
    this.root.querySelector('#sound').addEventListener('click', (e) => {
      setMuted(!isMuted());
      const b = e.currentTarget;
      b.innerHTML = `${icon(isMuted() ? 'mute' : 'sound')}<span>${isMuted() ? 'Sound off' : 'Sound on'}</span>`;
    });
  }
}
