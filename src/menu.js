// Title-screen flow, laid out like the original's classic menu: logo over drifting
// crewmates, Online / Freeplay / How To Play, then Host / Public / Private for online.

import { COLORS, SETTINGS } from './config.js';
import { bean } from './screens.js';
import { escapeHtml, icon } from './hud.js';
import { sfx, unlock, getVolume, setVolume, isMuted, setMuted } from './audio.js';

const VERSION = 'v0.2';

const fmt = (k, v) => {
  const d = SETTINGS[k];
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (d.options) return v[0].toUpperCase() + v.slice(1);
  return `${v}${d.unit || ''}`;
};

/** Game settings as text lines, like the list in the original's lobby. */
export function settingsText(settings) {
  return Object.entries(SETTINGS).map(([k, d]) => [d.label, fmt(k, settings[k])]);
}

/** Editable settings rows (− value +). Calls onChange(newSettings). */
export function settingsRows(box, settings, { editable = true, onChange, skip = [] } = {}) {
  const keys = Object.keys(SETTINGS).filter((k) => !skip.includes(k));
  const render = () => {
    box.innerHTML = keys
      .map((k) => {
        const d = SETTINGS[k];
        const v = settings[k];
        let ctl = `<output>${fmt(k, v)}</output>`;
        if (editable && typeof d.def === 'boolean')
          ctl = `<button type="button" class="step" data-k="${k}" data-d="0" aria-label="Toggle ${d.label}">${fmt(k, v)}</button>`;
        else if (editable) {
          ctl = `<button type="button" class="step" data-k="${k}" data-d="-1" aria-label="Decrease ${d.label}">−</button><output>${fmt(k, v)}</output><button type="button" class="step" data-k="${k}" data-d="1" aria-label="Increase ${d.label}">+</button>`;
        }
        return `<div class="row"><span>${d.label}</span><div class="ctl">${ctl}</div></div>`;
      })
      .join('');
  };
  render();
  box.onclick = (e) => {
    const b = e.target.closest('.step');
    if (!b) return;
    const k = b.dataset.k;
    const dir = Number(b.dataset.d);
    const d = SETTINGS[k];
    const v = settings[k];
    let next = v;
    if (typeof d.def === 'boolean') next = !v;
    else if (d.options) next = d.options[(d.options.indexOf(v) + dir + d.options.length) % d.options.length];
    else next = Math.round(Math.max(d.min, Math.min(d.max, v + dir * d.step)) * 100) / 100;
    settings = { ...settings, [k]: next };
    sfx('click');
    render();
    onChange?.(settings);
  };
  return { set: (s) => ((settings = s), render()) };
}

/** Background crewmates tumbling through space. */
function floaters(root) {
  const box = document.createElement('div');
  box.className = 'menu-floaters';
  box.setAttribute('aria-hidden', 'true');
  COLORS.forEach(([, color, shadow], i) => {
    if (i % 2) return;
    const kind = i === 6 ? 'body' : 'alive';
    const c = bean({ color, shadow }, 34 + ((i * 7) % 4) * 14, { kind });
    c.style.setProperty('--y', `${6 + ((i * 41) % 86)}%`);
    c.style.setProperty('--dur', `${22 + ((i * 13) % 5) * 6}s`);
    c.style.setProperty('--delay', `${-((i * 37) % 30)}s`);
    c.style.setProperty('--spin', `${i % 4 < 2 ? 1 : -1}`);
    box.appendChild(c);
  });
  root.prepend(box);
}

export class Menu {
  /**
   * @param {import('./screens.js').Screens} screens
   * @param {object} h { prefs, savePrefs, onFreeplay, onHost, onJoin, onFind, serverUrl, setServerUrl, setNet }
   */
  constructor(screens, h) {
    this.s = screens;
    this.h = h;
  }

  logo() {
    return `<h1 class="logo" aria-label="Sus Station"><span class="sus">Sus</span> <span class="word">Stati<span class="logo-o"></span>n</span></h1>`;
  }

  frame(cls, html) {
    this.s.open(`menu ${cls}`, html, { speed: 10, dense: 1.2 });
    floaters(this.s.root);
    const o = this.s.root.querySelector('.logo-o');
    if (o) o.appendChild(bean({ color: COLORS[this.h.prefs.color][1], shadow: COLORS[this.h.prefs.color][2] }, 64));
    this.s.root.querySelectorAll('button').forEach((b) => b.addEventListener('pointerenter', () => sfx('hover')));
  }

  // ---------- title ----------
  main(message) {
    this.frame(
      'title',
      `<div class="title-wrap">
        ${this.logo()}
        <nav class="title-buttons" aria-label="Main menu">
          <button class="menu-btn" id="m-online" type="button">Online</button>
          <button class="menu-btn" id="m-howto" type="button">How To Play</button>
          <button class="menu-btn" id="m-free" type="button">Freeplay</button>
        </nav>
        ${message ? `<p class="menu-msg" role="status">${escapeHtml(message)}</p>` : ''}
      </div>
      <div class="corner-left"><button class="round-btn" id="m-settings" type="button" aria-label="Settings">${icon('gear')}</button></div>
      <div class="corner-right">${VERSION}</div>`,
    );
    const r = this.s.root;
    const go = (fn) => () => {
      unlock();
      sfx('click');
      fn();
    };
    r.querySelector('#m-online').addEventListener(
      'click',
      go(() => this.online()),
    );
    r.querySelector('#m-howto').addEventListener(
      'click',
      go(() => this.howto()),
    );
    r.querySelector('#m-free').addEventListener(
      'click',
      go(() => this.h.onFreeplay()),
    );
    r.querySelector('#m-settings').addEventListener(
      'click',
      go(() => this.settings(() => this.main())),
    );
  }

  // ---------- online ----------
  online(message) {
    const p = this.h.prefs;
    const p2p = p.net !== 'server';
    this.frame(
      'online',
      `<div class="online-wrap">
        <label class="name-box"><span>Enter Name</span><input id="o-name" maxlength="10" autocomplete="off" spellcheck="false" value="${escapeHtml(p.name)}"></label>
        <div class="online-grid">
          <section class="online-card">
            <h2>Host</h2>
            <div class="host-art"></div>
            <div class="host-opts">
              <div class="opt"><span>Max players</span><div class="ctl"><button type="button" class="step" data-o="players" data-d="-1" aria-label="Fewer players">−</button><output id="o-players">${p.settings.players}</output><button type="button" class="step" data-o="players" data-d="1" aria-label="More players">+</button></div></div>
              <div class="opt"><span>Impostors</span><div class="ctl"><button type="button" class="step" data-o="impostors" data-d="-1" aria-label="Fewer impostors">−</button><output id="o-imps">${p.settings.impostors}</output><button type="button" class="step" data-o="impostors" data-d="1" aria-label="More impostors">+</button></div></div>
              ${p2p ? '' : `<div class="opt"><span>Lobby</span><div class="seg small" role="radiogroup" aria-label="Lobby visibility"><button type="button" role="radio" data-pub="1" aria-checked="${!!p.pub}">Public</button><button type="button" role="radio" data-pub="0" aria-checked="${!p.pub}">Private</button></div></div>`}
            </div>
            <button class="menu-btn small" id="o-host" type="button">Create Game</button>
          </section>
          <section class="online-card">
            <h2>Public</h2>
            <div class="games" id="o-games"><p class="muted">${p2p ? 'Peer-to-peer games are private: the host shares the 6-letter code with friends. A dedicated server (Settings) adds public listings.' : 'Find a game other players are hosting.'}</p></div>
            <button class="menu-btn small" id="o-find" type="button" ${p2p ? 'hidden' : ''}>Find Game</button>
          </section>
          <section class="online-card">
            <h2>Private</h2>
            <label class="code-box"><span>Enter Code</span><input id="o-code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABCDEF"></label>
            <button class="menu-btn small" id="o-join" type="button">Join</button>
          </section>
        </div>
        <p class="menu-msg" role="status" id="o-msg">${message ? escapeHtml(message) : ''}</p>
        <p class="server-note">${p2p ? 'Peer-to-peer: the host’s browser runs the game, no server needed' : `Dedicated server: <code>${escapeHtml(this.h.serverUrl())}</code>`} · <button type="button" class="link" id="o-server">change</button></p>
      </div>
      <div class="corner-left"><button class="round-btn" id="o-back" type="button" aria-label="Back">←</button></div>`,
    );
    const r = this.s.root;
    const art = r.querySelector('.host-art');
    COLORS.slice(0, 3).forEach(([, color, shadow], i) => art.appendChild(bean({ color, shadow }, 54, { facing: i === 2 ? -1 : 1 })));
    const name = r.querySelector('#o-name');
    name.addEventListener('input', () => {
      p.name = name.value.trim().slice(0, 10);
      this.h.savePrefs();
    });
    const msg = (t) => (r.querySelector('#o-msg').textContent = t);
    const needName = () => {
      if (p.name) return true;
      msg('Enter a name first.');
      name.focus();
      return false;
    };
    r.querySelectorAll('[data-o]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.o;
        const d = SETTINGS[k];
        p.settings[k] = Math.max(d.min, Math.min(d.max, p.settings[k] + Number(b.dataset.d)));
        r.querySelector(k === 'players' ? '#o-players' : '#o-imps').textContent = p.settings[k];
        this.h.savePrefs();
        sfx('click');
      }),
    );
    r.querySelector('.seg')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pub]');
      if (!b) return;
      p.pub = b.dataset.pub === '1';
      r.querySelectorAll('[data-pub]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      this.h.savePrefs();
    });
    r.querySelector('#o-host').addEventListener('click', () => needName() && (msg('Connecting…'), this.h.onHost()));
    const code = r.querySelector('#o-code');
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '')));
    const join = () => {
      if (!needName()) return;
      if (code.value.length !== 6) return msg('Codes are 6 letters.');
      msg('Connecting…');
      this.h.onJoin(code.value);
    };
    r.querySelector('#o-join').addEventListener('click', join);
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    r.querySelector('#o-find').addEventListener('click', async () => {
      const box = r.querySelector('#o-games');
      box.innerHTML = '<p class="muted">Looking for games…</p>';
      try {
        const games = await this.h.onFind();
        if (!r.contains(box)) return;
        box.innerHTML = games.length
          ? games
              .map(
                (g) =>
                  `<button type="button" class="game-row" data-code="${escapeHtml(g.code)}"><b>${escapeHtml(g.host)}</b><span>${g.n}/${g.max}</span><span>${g.imps} imp</span></button>`,
              )
              .join('')
          : '<p class="muted">No public games right now. Host one!</p>';
        box.querySelectorAll('.game-row').forEach((b) =>
          b.addEventListener('click', () => {
            if (!needName()) return;
            msg('Joining…');
            this.h.onJoin(b.dataset.code);
          }),
        );
      } catch (err) {
        box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }
    });
    r.querySelector('#o-server').addEventListener('click', () => this.settings(() => this.online()));
    r.querySelector('#o-back').addEventListener('click', () => this.main());
  }

  /** Show an error under the online panels without rebuilding them. */
  onlineMessage(text) {
    const el = this.s.root.querySelector('#o-msg');
    if (el) el.textContent = text;
    else this.online(text);
  }

  // ---------- how to play ----------
  howto() {
    const pages = [
      {
        title: 'Crewmates',
        art: [
          ['alive', 0],
          ['alive', 1],
          ['alive', 10],
        ],
        text: 'Finish your tasks. The yellow outlines and the list in the top left show where they are. When every task on the ship is done, the crew wins.',
      },
      {
        title: 'Impostors',
        art: [
          ['alive', 0, 'imp'],
          ['body', 7],
        ],
        text: 'Blend in. Kill crewmates when nobody is watching, slip through vents, and sabotage the ship. Win by matching the crew in number, or when Reactor or O2 runs out.',
      },
      {
        title: 'Meetings',
        art: [
          ['alive', 4],
          ['alive', 3],
          ['ghost', 11],
        ],
        text: 'Find a body? Report it. Suspect someone? Press the emergency button in the Cafeteria. Discuss, then vote someone out or skip. Ties eject no one.',
      },
      {
        title: 'Controls',
        art: [],
        text: 'Move with WASD or the arrow keys, or drag on a touch screen. E uses things, R reports, Q kills, V vents, F sabotages, Tab opens the map, Esc closes panels.',
      },
    ];
    let i = 0;
    this.frame(
      'howto',
      `<div class="howto-wrap">
        <h2 class="howto-title"></h2>
        <div class="howto-art"></div>
        <p class="howto-text"></p>
        <div class="howto-nav">
          <button class="round-btn" id="h-prev" type="button" aria-label="Previous page">‹</button>
          <span class="howto-dots"></span>
          <button class="round-btn" id="h-next" type="button" aria-label="Next page">›</button>
        </div>
      </div>
      <div class="corner-left"><button class="round-btn" id="h-back" type="button" aria-label="Back">←</button></div>`,
    );
    const r = this.s.root;
    const render = () => {
      const pg = pages[i];
      r.querySelector('.howto-title').textContent = pg.title;
      r.querySelector('.howto-title').className = `howto-title ${pg.title === 'Impostors' ? 'imp' : ''}`;
      r.querySelector('.howto-text').textContent = pg.text;
      const art = r.querySelector('.howto-art');
      art.innerHTML = '';
      if (!pg.art.length) {
        art.innerHTML = `<div class="keys">${['W', 'A', 'S', 'D', 'E', 'R', 'Q', 'V', 'F'].map((k) => `<kbd>${k}</kbd>`).join('')}</div>`;
      }
      for (const [kind, ci] of pg.art) {
        const [, color, shadow] = COLORS[ci];
        art.appendChild(bean({ color, shadow }, 110, { kind }));
      }
      r.querySelector('.howto-dots').innerHTML = pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    };
    render();
    r.querySelector('#h-prev').addEventListener('click', () => ((i = (i + pages.length - 1) % pages.length), sfx('click'), render()));
    r.querySelector('#h-next').addEventListener('click', () => ((i = (i + 1) % pages.length), sfx('click'), render()));
    r.querySelector('#h-back').addEventListener('click', () => this.main());
  }

  // ---------- settings ----------
  settings(onBack) {
    const p = this.h.prefs;
    const vol = (ch, label) =>
      `<label class="slider"><span>${label}</span><input type="range" min="0" max="100" step="1" id="v-${ch}" value="${Math.round(getVolume(ch) * 100)}"><output id="vo-${ch}">${Math.round(getVolume(ch) * 100)}</output></label>`;
    this.frame(
      'settings-screen',
      `<div class="settings-wrap card">
        <h2>Settings</h2>
        <h3>Sound</h3>
        ${vol('master', 'Master')}${vol('music', 'Music')}${vol('sfx', 'Sound effects')}
        <button class="menu-btn small" id="s-mute" type="button">${isMuted() ? 'Sound: Off' : 'Sound: On'}</button>
        <h3>Online</h3>
        <div class="seg small" id="s-net" role="radiogroup" aria-label="Connection">
          <button type="button" role="radio" data-net="p2p" aria-checked="${p.net !== 'server'}">Peer-to-peer</button><button type="button" role="radio" data-net="server" aria-checked="${p.net === 'server'}">Dedicated server</button>
        </div>
        <div id="s-p2p" ${p.net === 'server' ? 'hidden' : ''}>
          <p class="muted">The host’s browser runs the game and friends connect straight to it. A free public PeerJS service introduces players by code; leave the box empty to use it, or enter your own PeerJS server.</p>
          <label class="field"><span>Matchmaking service</span><input id="s-signal" spellcheck="false" autocomplete="off" placeholder="free public PeerJS service" value="${escapeHtml(p.signal || '')}"></label>
        </div>
        <div id="s-srv" ${p.net === 'server' ? '' : 'hidden'}>
          <p class="muted">Games run on a Sus Station server (npm start). It also lists public games.</p>
          <label class="field"><span>Server address</span><input id="s-server" spellcheck="false" autocomplete="off" value="${escapeHtml(this.h.serverUrl())}"></label>
        </div>
        <button class="menu-btn small" id="s-done" type="button">Done</button>
      </div>`,
    );
    const r = this.s.root;
    for (const ch of ['master', 'music', 'sfx']) {
      const input = r.querySelector(`#v-${ch}`);
      input.addEventListener('input', () => {
        unlock();
        setVolume(ch, Number(input.value) / 100);
        r.querySelector(`#vo-${ch}`).textContent = input.value;
      });
      input.addEventListener('change', () => ch === 'sfx' && sfx('good'));
    }
    r.querySelector('#s-mute').addEventListener('click', (e) => {
      setMuted(!isMuted());
      e.currentTarget.textContent = isMuted() ? 'Sound: Off' : 'Sound: On';
    });
    let net = p.net === 'server' ? 'server' : 'p2p';
    r.querySelector('#s-net').addEventListener('click', (e) => {
      const b = e.target.closest('[data-net]');
      if (!b) return;
      net = b.dataset.net;
      r.querySelectorAll('[data-net]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      r.querySelector('#s-p2p').hidden = net !== 'p2p';
      r.querySelector('#s-srv').hidden = net !== 'server';
    });
    r.querySelector('#s-done').addEventListener('click', () => {
      this.h.setServerUrl(r.querySelector('#s-server').value.trim());
      this.h.setNet(net, r.querySelector('#s-signal').value.trim());
      sfx('click');
      onBack();
    });
  }
}
