// Pre-game lobby overlay: settings list, room code, player count, Start button,
// laptop customize panel and the host's settings editor.

import { COLORS } from './config.js';
import { bean } from './screens.js';
import { drawCharacter, WALK_FRAMES, WALK_FPS } from './sprites.js';
import { HATS, VISORS, SKINS, PETS, PET_FRAMES, drawPet } from './cosmetics.js';
import { escapeHtml, icon } from './hud.js';
import { settingsText, settingsRows } from './menu.js';
import { sfx } from './audio.js';

const TABS = [
  { id: 'color', label: 'Color' },
  { id: 'hat', label: 'Hat', slot: 'hat', list: HATS },
  { id: 'visor', label: 'Visor', slot: 'visor', list: VISORS },
  { id: 'skin', label: 'Skin', slot: 'skin', list: SKINS },
  { id: 'pet', label: 'Pet', slot: 'pet', list: PETS },
];

function inkStyle(ctx) {
  ctx.lineWidth = 0.075;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#07090c';
}

/** A pet on its own, about `size` px tall. */
function petCanvas(id, size) {
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = size / 0.8;
  c.width = Math.ceil(1.2 * s * dpr);
  c.height = Math.ceil(0.95 * s * dpr);
  c.style.width = `${1.2 * s}px`;
  c.style.height = `${0.95 * s}px`;
  c.className = 'bean';
  const ctx = c.getContext('2d');
  ctx.scale(s * dpr, s * dpr);
  ctx.translate(0.6, 0.85);
  inkStyle(ctx);
  drawPet(ctx, id, -1);
  return c;
}

export class LobbyUI {
  /** @param {object} h { onStart, onLeave, onSettingsScreen, onCustomize, onSettings, onKick } */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    root.hidden = true;
    root.innerHTML = `
      <section class="lobby-info" aria-label="Game settings"><ul class="lobby-settings"></ul><button class="pill" id="l-edit" type="button">Edit settings</button></section>
      <div class="lobby-top">
        <button class="hud-btn" id="l-gear" type="button" aria-label="Settings">${icon('gear')}</button>
        <button class="hud-btn leave" id="l-leave" type="button" aria-label="Leave lobby">✕</button>
      </div>
      <div class="lobby-bottom">
        <div class="lobby-code"><span>Code</span><b id="l-code"></b><button class="pill" id="l-copy" type="button">Copy</button></div>
        <div class="lobby-startrow">
          <button class="start-btn" id="l-start" type="button">Start</button>
          <span class="lobby-count" id="l-count"></span>
        </div>
        <p class="lobby-wait" id="l-wait">Waiting for the host to start…</p>
      </div>
      <div class="lobby-actions"><button class="act lobby-use" id="l-use" type="button">${icon('use')}<b>Customize</b></button></div>
      <div class="lobby-countdown" id="l-countdown" aria-live="assertive"></div>
      <div class="toast" id="l-toast" role="status"></div>
      <div class="lobby-panel" id="p-custom" hidden>
        <div class="panel-card custom-card">
          <button class="mg-close" type="button" data-close aria-label="Close">✕</button>
          <div class="custom-tabs" role="tablist" aria-label="Customize">
            ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div class="custom-grid">
            <div class="custom-preview"><canvas class="custom-stage"></canvas></div>
            <div class="custom-fields">
              <div class="custom-pane" data-pane="color">
                <label class="field"><span>Name</span><input id="c-name" maxlength="10" autocomplete="off" spellcheck="false"></label>
                <div class="field"><span>Color</span><div class="swatches" id="c-colors"></div></div>
                <div class="field" id="c-role-field"><span>Role (freeplay)</span>
                  <div class="seg" role="radiogroup" aria-label="Role">
                    <button type="button" role="radio" data-role="random">Random</button><button type="button" role="radio" data-role="crew">Crewmate</button><button type="button" role="radio" data-role="impostor">Impostor</button>
                  </div>
                </div>
              </div>
              <div class="custom-pane" data-pane="items" hidden>
                <p class="item-name" id="c-item-name"></p>
                <div class="items" id="c-items" role="listbox"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="lobby-panel" id="p-options" hidden>
        <div class="panel-card wide">
          <button class="mg-close" type="button" data-close aria-label="Close">✕</button>
          <h2>Game settings</h2>
          <div class="seg small" id="o-vis" role="radiogroup" aria-label="Lobby visibility"><button type="button" role="radio" data-pub="1">Public</button><button type="button" role="radio" data-pub="0">Private</button></div>
          <div class="rows" id="o-rows"></div>
          <h3>Players</h3>
          <ul class="player-list" id="o-players"></ul>
        </div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    this.$ = $;
    $('#l-start').addEventListener('click', () => this.h.onStart());
    $('#l-leave').addEventListener('click', () => this.h.onLeave());
    $('#l-gear').addEventListener('click', () => this.h.onSettingsScreen());
    $('#l-use').addEventListener('click', () => this.use());
    $('#l-edit').addEventListener('click', () => this.openOptions());
    $('#l-copy').addEventListener('click', () => {
      const code = this.session?.code;
      if (!code) return;
      navigator.clipboard?.writeText(code).then(
        () => this.toast('Code copied'),
        () => this.toast(`Code: ${code}`),
      );
    });
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closePanels()));
    root.querySelectorAll('.lobby-panel').forEach((p) => p.addEventListener('pointerdown', (e) => e.target === p && this.closePanels()));
    $('#c-name').addEventListener('change', (e) => this.h.onCustomize({ name: e.target.value.trim().slice(0, 10) || undefined }));
    $('#c-colors').addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b || b.disabled) return;
      sfx('click');
      this.h.onCustomize({ color: Number(b.dataset.color) });
    });
    this.tab = 'color';
    $('.custom-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === this.tab) return;
      sfx('click');
      this.tab = b.dataset.tab;
      this.renderCustomize();
    });
    $('#c-items').addEventListener('click', (e) => {
      const b = e.target.closest('[data-item]');
      if (!b) return;
      sfx('click');
      const slot = TABS.find((t) => t.id === this.tab).slot;
      this.h.onCustomize({ outfit: { [slot]: b.dataset.item } });
    });
    $('#c-items').addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-item]');
      if (b) $('#c-item-name').textContent = b.title;
    });
    $('#c-role-field').addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (b) this.h.onCustomize({ role: b.dataset.role });
    });
    $('#o-vis').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pub]');
      if (b) this.h.onSettings(null, b.dataset.pub === '1');
    });
    $('#o-players').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kick]');
      if (b) this.h.onKick(b.dataset.kick);
    });
  }

  get panelOpen() {
    return [...this.root.querySelectorAll('.lobby-panel')].some((p) => !p.hidden);
  }

  show(session) {
    this.session = session;
    this.root.hidden = false;
    this.closePanels();
    this.countdown(0);
    this.sig = '';
    this.refresh();
  }

  hide() {
    this.root.hidden = true;
    this.closePanels();
  }

  toast(text) {
    const t = this.$('#l-toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  countdown(n) {
    const el = this.$('#l-countdown');
    el.textContent = n > 0 ? `Starting in ${n}` : '';
    el.classList.toggle('on', n > 0);
    if (n > 0) sfx('countdown');
  }

  use() {
    const g = this.session?.lobbyGame;
    if (!g?.local || !g.usable(g.local)) return;
    sfx('open');
    this.openCustomize();
  }

  closePanels() {
    this.root.querySelectorAll('.lobby-panel').forEach((p) => (p.hidden = true));
    window.cancelAnimationFrame(this.stageRaf);
  }

  // ---------- panels ----------
  openCustomize() {
    this.closePanels();
    this.$('#p-custom').hidden = false;
    this.renderCustomize();
    const loop = (t) => {
      this.drawStage(t / 1000);
      this.stageRaf = requestAnimationFrame(loop);
    };
    this.stageRaf = requestAnimationFrame(loop);
  }

  /** My current look: color from the room (online colors can be taken), outfit from prefs. */
  myLook() {
    const s = this.session;
    const mine = s.roomPlayers().find((p) => p.you);
    const color = mine ? mine.color : s.prefs.color;
    const [, c, sh] = COLORS[color];
    return { colorIndex: color, color: c, shadow: sh, outfit: s.prefs.outfit || {} };
  }

  /** The preview: you walking in place, pet trotting alongside. */
  drawStage(t) {
    const cv = this.$('.custom-stage');
    const box = cv.parentElement.getBoundingClientRect();
    if (!box.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const look = this.myLook();
    const pet = look.outfit.pet && look.outfit.pet !== 'none';
    const s = Math.min(w / (pet ? 2.6 : 1.9), h / 2.5) * dpr; // px per cell
    const fx = (pet ? w * 0.6 : w / 2) * dpr;
    const fy = h * 0.86 * dpr;
    const walking = Math.floor(t / 2.5) % 2 === 1; // stand, then walk in place
    const frame = walking ? Math.floor(t * WALK_FPS) % WALK_FRAMES : -1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 0.5 * s, 0.16 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(s, s);
    drawCharacter(ctx, look, { frame });
    ctx.restore();
    if (pet) {
      const px = fx - 1.05 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(px, fy, 0.3 * s, 0.1 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(px, fy);
      ctx.scale(s, s);
      inkStyle(ctx);
      drawPet(ctx, look.outfit.pet, walking ? Math.floor(t * 16) % PET_FRAMES : -1);
      ctx.restore();
    }
  }

  renderCustomize() {
    const s = this.session;
    const prefs = s.prefs;
    const mine = s.roomPlayers().find((p) => p.you);
    const color = mine ? mine.color : prefs.color;
    const taken = new Set(
      s.online
        ? s
            .roomPlayers()
            .filter((p) => !p.you)
            .map((p) => p.color)
        : [],
    );
    this.root
      .querySelectorAll('.custom-tabs [data-tab]')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
    this.$('[data-pane=color]').hidden = this.tab !== 'color';
    this.$('[data-pane=items]').hidden = this.tab === 'color';
    if (this.tab !== 'color') return this.renderItems();
    const name = this.$('#c-name');
    if (document.activeElement !== name) name.value = mine?.name || prefs.name;
    this.$('#c-colors').innerHTML = COLORS.map(
      ([n], i) =>
        `<button type="button" class="swatch" data-color="${i}" aria-label="${n}${taken.has(i) ? ' (taken)' : ''}" aria-pressed="${i === color}" ${taken.has(i) ? 'disabled' : ''}></button>`,
    ).join('');
    this.$('#c-colors')
      .querySelectorAll('.swatch')
      .forEach((b) => {
        const [, col, shad] = COLORS[Number(b.dataset.color)];
        b.appendChild(bean({ color: col, shadow: shad }, 28));
      });
    const roleField = this.$('#c-role-field');
    roleField.hidden = s.online;
    roleField.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.role === prefs.role)));
  }

  /** The grid of hats, visors, skins or pets, each shown on you in your color. */
  renderItems() {
    const tab = TABS.find((t) => t.id === this.tab);
    const look = this.myLook();
    const current = look.outfit[tab.slot] || 'none';
    const box = this.$('#c-items');
    box.innerHTML = '';
    for (const it of tab.list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch item';
      b.dataset.item = it.id;
      b.title = it.name;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', it.name);
      b.setAttribute('aria-pressed', String(it.id === current));
      if (it.id === 'none') b.innerHTML = '<span class="item-none" aria-hidden="true"></span>';
      else if (tab.slot === 'pet') b.appendChild(petCanvas(it.id, 46));
      else b.appendChild(bean({ ...look, outfit: { [tab.slot]: it.id } }, 46));
      box.appendChild(b);
    }
    this.$('#c-item-name').textContent = tab.list.find((it) => it.id === current)?.name || 'None';
  }

  openOptions() {
    this.closePanels();
    this.$('#p-options').hidden = false;
    this.renderOptions(true);
  }

  renderOptions(full) {
    const s = this.session;
    const settings = s.online ? s.room?.settings : s.prefs.settings;
    if (!settings) return;
    const editable = s.isHost;
    const vis = this.$('#o-vis');
    vis.hidden = !s.online || !editable || s.mode === 'p2p';
    vis.querySelectorAll('[data-pub]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.pub === '1') === !!s.room?.pub)));
    if (full || !this.rows) {
      this.rows = settingsRows(this.$('#o-rows'), settings, {
        editable,
        skip: s.online ? [] : ['fillBots'],
        onChange: (next) => this.h.onSettings(next),
      });
    } else this.rows.set(settings);
    this.$('#o-players').innerHTML = s
      .roomPlayers()
      .map((p) => {
        const [, col] = COLORS[p.color];
        const kick =
          s.online && editable && !p.you ? `<button type="button" class="pill" data-kick="${escapeHtml(p.id)}">Kick</button>` : '';
        return `<li><i style="background:${col}"></i><span>${escapeHtml(p.name)}${p.you ? ' (you)' : ''}${p.bot ? ' · bot' : ''}</span>${kick}</li>`;
      })
      .join('');
  }

  /** Called when the room (players, settings, host) changes. */
  refresh() {
    const s = this.session;
    if (!s) return;
    const settings = s.online ? s.room?.settings : s.prefs.settings;
    if (!settings) return;
    this.$('.lobby-settings').innerHTML = [['Map', 'The Kestrel'], ...settingsText(settings)]
      .filter(([k]) => s.online || k !== 'Fill With Bots')
      .map(([k, v]) => `<li><span>${escapeHtml(k)}:</span> <b>${escapeHtml(v)}</b></li>`)
      .join('');
    this.$('#l-edit').textContent = s.isHost ? 'Edit settings' : 'View settings';
    const code = this.$('.lobby-code');
    code.hidden = !s.online;
    this.$('#l-code').textContent = s.code || '';
    if (!this.$('#p-custom').hidden) this.renderCustomize();
    if (!this.$('#p-options').hidden) this.renderOptions(false);
  }

  update() {
    const s = this.session;
    if (!s || this.root.hidden) return;
    const n = s.online ? s.roomPlayers().length : s.prefs.settings.players;
    const max = s.online ? s.room?.settings.players : s.prefs.settings.players;
    this.$('#l-count').textContent = `${n}/${max}`;
    this.$('#l-start').hidden = !s.isHost;
    this.$('#l-start').disabled = s.countdown > 0;
    this.$('#l-wait').hidden = s.isHost;
    const g = s.lobbyGame;
    this.$('#l-use').disabled = !(g?.local && g.usable(g.local));
  }
}
