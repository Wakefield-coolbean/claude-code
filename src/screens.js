// Full-screen moments: menu, role reveal, meeting splash, kill, ejection, game over, pause.

import { COLORS, SETTINGS, TIMING } from './config.js';
import { drawCrewmate, drawGhost, drawBody } from './sprites.js';
import { sfx, isMuted, setMuted, unlock } from './audio.js';
import { escapeHtml, icon } from './hud.js';

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
class Starfield {
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

  // ---------- menu ----------
  menu(prefs, onPlay) {
    const swatches = COLORS.map(
      ([name], i) =>
        `<button type="button" class="swatch" data-color="${i}" aria-label="${name}" aria-pressed="${i === prefs.color}"></button>`,
    ).join('');
    this.open(
      'menu',
      `<div class="menu-floaters" aria-hidden="true"></div>
      <div class="menu-inner">
        <h1 class="logo"><span>Sus</span> Station</h1>
        <p class="tagline">Do your tasks. Trust no one. Vote them out.</p>
        <div class="menu-grid">
          <section class="card who">
            <label class="field"><span>Name</span><input id="name" maxlength="10" autocomplete="off" spellcheck="false" value="${escapeHtml(prefs.name)}"></label>
            <div class="field"><span>Color</span><div class="swatches">${swatches}</div></div>
            <div class="field"><span>Role</span>
              <div class="seg" role="radiogroup" aria-label="Role">
                ${['random', 'crew', 'impostor'].map((r) => `<button type="button" role="radio" data-role="${r}" aria-checked="${prefs.role === r}">${{ random: 'Random', crew: 'Crewmate', impostor: 'Impostor' }[r]}</button>`).join('')}
              </div>
            </div>
            <button class="big-btn play" id="play" type="button">Play</button>
            <p class="hint">Freeplay against bots. WASD or arrows to move, E use, R report, Q kill, V vent, F sabotage, Tab map. On touch screens, drag to move.</p>
            <details class="howto">
              <summary>How to play</summary>
              <ul>
                <li><b class="crew-t">Crewmates</b> win by finishing every task on the list (top left) or by voting out every Impostor. Yellow outlines show where your tasks are.</li>
                <li><b class="imp-t">Impostors</b> win by killing until they equal the crew, or when Reactor or O2 isn't fixed in time. They can vent, sabotage and lock doors.</li>
                <li>Find a body? <b>Report</b> it. Suspicious? Press the <b>emergency button</b> in the Cafeteria. Then discuss, vote, or skip.</li>
                <li>When someone sabotages, follow the red arrows. Reactor needs two people holding the scanners at once.</li>
                <li>Dead crewmates become ghosts. Keep doing tasks: the crew can still win.</li>
              </ul>
            </details>
          </section>
          <section class="card settings">
            <h2>Game settings</h2>
            <div class="rows"></div>
          </section>
        </div>
      </div>`,
      { speed: 14 },
    );
    const root = this.root;
    const preview = () => {
      root.querySelectorAll('.swatch').forEach((b) => {
        const [, color, shadow] = COLORS[Number(b.dataset.color)];
        if (!b.firstChild) b.appendChild(bean({ color, shadow }, 30));
        b.setAttribute('aria-pressed', String(Number(b.dataset.color) === prefs.color));
      });
    };
    preview();
    root.querySelector('.swatches').addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b) return;
      prefs.color = Number(b.dataset.color);
      sfx('click');
      preview();
    });
    root.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (!b) return;
      prefs.role = b.dataset.role;
      root.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
    root.querySelector('#name').addEventListener('input', (e) => (prefs.name = e.target.value.trim().slice(0, 10)));

    const rows = root.querySelector('.rows');
    const fmt = (k, v) => {
      const d = SETTINGS[k];
      if (typeof v === 'boolean') return v ? 'On' : 'Off';
      if (d.options) return v[0].toUpperCase() + v.slice(1);
      return `${v}${d.unit || ''}`;
    };
    const render = () => {
      rows.innerHTML = Object.entries(SETTINGS)
        .map(([k, d]) => {
          const v = prefs.settings[k];
          const btns =
            typeof d.def === 'boolean'
              ? `<button type="button" class="step" data-k="${k}" data-d="0" aria-label="Toggle ${d.label}">${fmt(k, v)}</button>`
              : `<button type="button" class="step" data-k="${k}" data-d="-1" aria-label="Decrease ${d.label}">−</button><output>${fmt(k, v)}</output><button type="button" class="step" data-k="${k}" data-d="1" aria-label="Increase ${d.label}">+</button>`;
          return `<div class="row"><span>${d.label}</span><div class="ctl">${btns}</div></div>`;
        })
        .join('');
    };
    render();
    rows.addEventListener('click', (e) => {
      const b = e.target.closest('.step');
      if (!b) return;
      const k = b.dataset.k;
      const dir = Number(b.dataset.d);
      const d = SETTINGS[k];
      const v = prefs.settings[k];
      if (typeof d.def === 'boolean') prefs.settings[k] = !v;
      else if (d.options) {
        const i = d.options.indexOf(v);
        prefs.settings[k] = d.options[(i + dir + d.options.length) % d.options.length];
      } else {
        prefs.settings[k] = Math.round(Math.max(d.min, Math.min(d.max, v + dir * d.step)) * 100) / 100;
      }
      sfx('click');
      render();
    });

    // Floating crewmates drifting through space, as on the original title screen.
    const floaters = root.querySelector('.menu-floaters');
    COLORS.slice(0, 7).forEach(([, color, shadow], i) => {
      const c = bean({ color, shadow }, 40 + (i % 3) * 16, { kind: i === 3 ? 'body' : 'alive' });
      c.style.setProperty('--y', `${8 + ((i * 37) % 80)}%`);
      c.style.setProperty('--dur', `${18 + i * 4}s`);
      c.style.setProperty('--delay', `${-i * 5}s`);
      floaters.appendChild(c);
    });

    root.querySelector('#play').addEventListener('click', () => {
      unlock();
      sfx('click');
      onPlay();
    });
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
      sfx('reveal');
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
       <div class="over-actions"><button class="big-btn" id="again" type="button">Play again</button><button class="big-btn ghost" id="menu" type="button">Main menu</button></div>`,
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
  pause({ onResume, onQuit }) {
    this.open(
      'pause',
      `<div class="card pause-card">
        <h2>Paused</h2>
        <button class="big-btn" id="resume" type="button">Resume</button>
        <button class="big-btn ghost" id="sound" type="button">${icon(isMuted() ? 'mute' : 'sound')}<span>${isMuted() ? 'Sound off' : 'Sound on'}</span></button>
        <button class="big-btn ghost" id="quit" type="button">Quit to menu</button>
        <p class="hint">WASD / arrows move · E use · R report · Q kill · V vent · F sabotage · Tab map · Esc close</p>
      </div>`,
    );
    this.root.querySelector('#resume').addEventListener('click', onResume);
    this.root.querySelector('#quit').addEventListener('click', onQuit);
    this.root.querySelector('#sound').addEventListener('click', (e) => {
      setMuted(!isMuted());
      const b = e.currentTarget;
      b.innerHTML = `${icon(isMuted() ? 'mute' : 'sound')}<span>${isMuted() ? 'Sound off' : 'Sound on'}</span>`;
    });
  }
}
