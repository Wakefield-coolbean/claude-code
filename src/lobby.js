// Pre-game lobby overlay: settings list, room code, player count, Start button,
// laptop customize panel and the host's settings editor.

import { COLORS } from './config.js';
import { bean } from './screens.js';
import { escapeHtml, icon } from './hud.js';
import { settingsText, settingsRows } from './menu.js';
import { sfx } from './audio.js';

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
        <div class="panel-card">
          <button class="mg-close" type="button" data-close aria-label="Close">✕</button>
          <h2>Customize</h2>
          <div class="custom-grid">
            <div class="custom-preview"></div>
            <div class="custom-fields">
              <label class="field"><span>Name</span><input id="c-name" maxlength="10" autocomplete="off" spellcheck="false"></label>
              <div class="field"><span>Color</span><div class="swatches" id="c-colors"></div></div>
              <div class="field" id="c-role-field"><span>Role (freeplay)</span>
                <div class="seg" role="radiogroup" aria-label="Role">
                  <button type="button" role="radio" data-role="random">Random</button><button type="button" role="radio" data-role="crew">Crewmate</button><button type="button" role="radio" data-role="impostor">Impostor</button>
                </div>
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
  }

  // ---------- panels ----------
  openCustomize() {
    this.closePanels();
    this.$('#p-custom').hidden = false;
    this.renderCustomize();
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
    const [, c, sh] = COLORS[color];
    const prev = this.$('.custom-preview');
    prev.innerHTML = '';
    prev.appendChild(bean({ color: c, shadow: sh }, 150));
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
    vis.hidden = !s.online || !editable;
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
