// HUD: task list, task bar, action buttons, vent arrows, toasts and the map overlay
// (plain map, admin table counts, impostor sabotage map, security camera feeds).

import { ventNeighbors } from './map.js';
import { drawCrewmate } from './sprites.js';

const ICONS = {
  use: '<path d="M30 58V30a5 5 0 0 1 10 0v18M40 46V22a5 5 0 0 1 10 0v24M50 46V26a5 5 0 0 1 10 0v24M60 50V36a5 5 0 0 1 10 0v26c0 14-10 24-24 24h-2c-9 0-15-4-20-12L18 60a5 5 0 0 1 8-6l4 4"/>',
  chat: '<path d="M16 22h64v40H44L28 76V62H16z"/><path d="M30 38h36M30 48h24"/>',
  report: '<path d="M18 40h12l30-16v52L30 60H18z"/><path d="M30 60l6 18h10l-6-18"/><path d="M68 36c6 4 6 20 0 24M76 30c10 8 10 28 0 36"/>',
  kill: '<path d="M22 74l30-30 6 6-30 30-8 2z"/><path d="M52 44l22-26 6 2-2 6-20 24z"/><path d="M44 52l10 10"/>',
  vent: '<rect x="16" y="28" width="64" height="40" rx="6"/><path d="M26 38h44M26 48h44M26 58h44"/>',
  sabotage: '<path d="M48 16l36 62H12z"/><path d="M48 38v20M48 66v2"/>',
  button: '<ellipse cx="48" cy="60" rx="30" ry="12"/><path d="M26 58c0-16 10-24 22-24s22 8 22 24"/>',
  admin: '<path d="M14 26l22-8 24 8 22-8v52l-22 8-24-8-22 8z"/><path d="M36 18v52M60 26v52"/>',
  cams: '<rect x="12" y="30" width="50" height="36" rx="7"/><path d="M62 43l22-11v32L62 53z"/><circle cx="31" cy="48" r="8"/>',
  map: '<path d="M14 26l22-8 24 8 22-8v52l-22 8-24-8-22 8z"/><path d="M36 18v52M60 26v52"/>',
  gear: '<path d="M81.3 41.4 L82.0 48.7 L71.5 52.7 L70.0 57.6 L76.3 66.9 L71.6 72.5 L61.3 68.0 L56.7 70.3 L54.6 81.3 L47.3 82.0 L43.3 71.5 L38.4 70.0 L29.1 76.3 L23.5 71.6 L28.0 61.3 L25.7 56.7 L14.7 54.6 L14.0 47.3 L24.5 43.3 L26.0 38.4 L19.7 29.1 L24.4 23.5 L34.7 28.0 L39.3 25.7 L41.4 14.7 L48.7 14.0 L52.7 24.5 L57.6 26.0 L66.9 19.7 L72.5 24.4 L68.0 34.7 L70.3 39.3Z"/><circle cx="48" cy="48" r="10"/>',
  sound: '<path d="M18 38h14l18-14v48L32 58H18z"/><path d="M62 36c6 6 6 18 0 24M70 28c12 10 12 30 0 40"/>',
  mute: '<path d="M18 38h14l18-14v48L32 58H18z"/><path d="M62 38l18 20M80 38L62 58"/>',
  lights: '<path d="M48 14a20 20 0 0 1 12 36v10H36V50a20 20 0 0 1 12-36z"/><path d="M38 68h20M40 76h16"/>',
  comms: '<path d="M22 70l26-26M48 44a16 16 0 1 0-16-16"/><path d="M34 82h28l-14-38z"/>',
  o2: '<circle cx="48" cy="48" r="28"/><path d="M40 40a8 8 0 1 0 0 .1M60 56h-8l8-8a4 4 0 0 0-8-2"/>',
  reactor:
    '<circle cx="48" cy="48" r="8"/><path d="M48 40L36 20a28 28 0 0 1 24 0zM41 52L18 52a28 28 0 0 0 12 21zM55 52l23 0a28 28 0 0 1-12 21z"/>',
  doors: '<rect x="24" y="16" width="48" height="64" rx="4"/><path d="M48 16v64M42 48h-4M58 48h-4"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 96 96" aria-hidden="true" class="ico ico-${name}">${ICONS[name] || ''}</svg>`;
}

const SAB_TARGETS = [
  { type: 'lights', room: 'electrical', label: 'Lights' },
  { type: 'comms', room: 'comms', label: 'Comms' },
  { type: 'o2', room: 'o2', label: 'O2' },
  { type: 'reactor', room: 'reactor', label: 'Reactor' },
];

export class Hud {
  constructor(root, game, renderer, handlers) {
    this.root = root;
    this.h = handlers;
    this.mapMode = null;
    root.innerHTML = `
      <div class="taskbar" hidden><div class="taskbar-fill"></div><span>Total tasks completed</span></div>
      <section class="tasks" aria-label="Task list">
        <button class="tasks-tab" type="button">Tasks</button>
        <div class="tasks-body"></div>
      </section>
      <div class="topright">
        <button class="hud-btn" data-ui="settings" type="button" aria-label="Menu">${icon('gear')}</button>
        <button class="hud-btn" data-ui="map" type="button" aria-label="Map">${icon('map')}</button>
      </div>
      <div class="actions">
        <button class="act" data-act="report" type="button">${icon('report')}<b>Report</b></button>
        <button class="act" data-act="vent" type="button">${icon('vent')}<b>Vent</b></button>
        <button class="act" data-act="kill" type="button">${icon('kill')}<b>Kill</b><i class="cd"></i></button>
        <button class="act" data-act="sabotage" type="button">${icon('sabotage')}<b>Sabotage</b><i class="cd"></i></button>
        <button class="act" data-act="use" type="button">${icon('use')}<b>Use</b></button>
      </div>
      <div class="vent-arrows"></div>
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="mapview" hidden>
        <div class="map-frame">
          <button class="map-close" type="button" aria-label="Close map">✕</button>
          <div class="map-title"></div>
          <div class="map-wrap"><canvas class="map-canvas"></canvas><canvas class="cams-canvas" hidden></canvas><div class="map-buttons"></div></div>
        </div>
      </div>`;
    this.el = {
      taskbar: root.querySelector('.taskbar'),
      fill: root.querySelector('.taskbar-fill'),
      tasks: root.querySelector('.tasks'),
      tasksBody: root.querySelector('.tasks-body'),
      actions: root.querySelector('.actions'),
      ventArrows: root.querySelector('.vent-arrows'),
      toast: root.querySelector('.toast'),
      mapview: root.querySelector('.mapview'),
      mapTitle: root.querySelector('.map-title'),
      mapCanvas: root.querySelector('.map-canvas'),
      camsCanvas: root.querySelector('.cams-canvas'),
      mapButtons: root.querySelector('.map-buttons'),
    };
    this.btn = {};
    root.querySelectorAll('.act').forEach((b) => {
      this.btn[b.dataset.act] = b;
      b.addEventListener('click', () => this.h.onAction(b.dataset.act));
    });
    root.querySelector('[data-ui=map]').addEventListener('click', () => this.h.onAction('map'));
    root.querySelector('[data-ui=settings]').addEventListener('click', () => this.h.onAction('settings'));
    root.querySelector('.map-close').addEventListener('click', () => this.closeMap());
    this.el.mapview.addEventListener('pointerdown', (e) => {
      if (e.target === this.el.mapview) this.closeMap();
    });
    root.querySelector('.tasks-tab').addEventListener('click', () => this.el.tasks.classList.toggle('collapsed'));
    this.setGame(game, renderer);
  }

  setGame(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.sig = '';
    this.ventSig = '';
    this.closeMap();
    this.el.ventArrows.innerHTML = '';
  }

  toast(text, ms = 2600) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- per frame ----------
  update(time) {
    const g = this.game;
    const me = g.local;
    if (!me) return;
    const playing = g.phase === 'play';
    this.root.classList.toggle('inactive', !playing);
    this.updateTasks(g, me);
    const bar = g.taskBar();
    this.el.taskbar.hidden = bar == null;
    if (bar != null) this.el.fill.style.width = `${(bar * 100).toFixed(1)}%`;

    const imp = me.role === 'impostor';
    const use = playing ? g.usable(me) : null;
    const show = (name, visible, enabled, cd) => {
      const b = this.btn[name];
      b.hidden = !visible;
      b.disabled = !enabled;
      const cdEl = b.querySelector('.cd');
      if (cdEl) cdEl.textContent = cd > 0 && cd < 999 ? Math.ceil(cd) : '';
    };
    show('use', me.alive || !imp, !!use && !me.inVent, 0);
    this.setUseLook(use);
    show('report', me.alive, !!g.reportable(me), 0);
    show('kill', imp && me.alive, !!g.killTarget(me) && me.killCooldown <= 0, me.killCooldown);
    show('vent', imp && me.alive, !!g.canVent(me), 0);
    const sabCd = g.sabotageCooldown();
    show('sabotage', imp, g.canSabotage(me), sabCd === Infinity ? 0 : sabCd);
    this.btn.sabotage.classList.toggle('busy', sabCd > 0);

    this.updateVentArrows(g, me);
    if (this.mapMode) this.drawMap(time);
  }

  setUseLook(use) {
    const kind = ['button', 'admin', 'cams'].includes(use?.kind) ? use.kind : 'use';
    if (this.useKind === kind) return;
    this.useKind = kind;
    const b = this.btn.use;
    b.querySelector('svg').outerHTML = icon(kind);
    b.querySelector('b').textContent = { admin: 'Admin', cams: 'Security' }[kind] || 'Use';
  }

  stepLabel(task) {
    const step = task.steps[Math.min(task.step, task.steps.length - 1)];
    const room = this.game.map.rooms[this.game.map.roomIndex[this.game.map.stations[step.station].room]].name;
    let label = `${room}: ${task.name}`;
    if (task.id === 'upload' && task.step === 0 && !task.done) label = `${room}: Download Data`;
    if (task.steps.length > 1) label += ` (${task.step}/${task.steps.length})`;
    if (!task.done && task.readyAt > this.game.t) label += ` ${Math.ceil(task.readyAt - this.game.t)}s`;
    return label;
  }

  updateTasks(g, me) {
    const s = g.sab.active;
    const lines = [];
    if (s) {
      if (s.type === 'reactor') {
        const n = Object.values(s.holders).filter((v) => v != null).length;
        lines.push(['alarm', `Reactor Meltdown in ${Math.max(0, Math.ceil(s.deadline - g.t))} (${n}/2)`]);
      } else if (s.type === 'o2') {
        const n = Object.values(s.done).filter(Boolean).length;
        lines.push(['alarm', `Oxygen depleted in ${Math.max(0, Math.ceil(s.deadline - g.t))} (${n}/2)`]);
      } else if (s.type === 'lights') lines.push(['alarm', 'Fix Lights (Electrical)']);
      else if (s.type === 'comms') lines.push(['alarm', 'Comms Sabotaged']);
    }
    if (me.role === 'impostor') {
      lines.push(['imp', me.alive ? 'Sabotage and kill everyone.' : 'You are dead. Keep sabotaging.']);
      lines.push(['imp', 'Fake Tasks:']);
    } else if (!me.alive) {
      lines.push(['ghost', 'You are dead. Finish your tasks to help the crew win.']);
    }
    if (s?.type === 'comms' && me.role !== 'impostor') {
      // Comms hides the task list.
    } else {
      for (const task of me.tasks) {
        const cls = task.done ? 'done' : task.step > 0 ? 'started' : '';
        lines.push([cls, this.stepLabel(task)]);
      }
    }
    const sig = lines.map((l) => l.join('|')).join('\n');
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.tasksBody.innerHTML = lines.map(([c, t]) => `<p class="${c}">${escapeHtml(t)}</p>`).join('');
  }

  updateVentArrows(g, me) {
    const sig = me.inVent && g.phase === 'play' ? me.inVent : '';
    if (sig === this.ventSig) {
      if (sig) this.positionVentArrows(g, me);
      return;
    }
    this.ventSig = sig;
    const box = this.el.ventArrows;
    box.innerHTML = '';
    if (!sig) return;
    for (const v of ventNeighbors(me.inVent)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vent-arrow';
      b.dataset.vent = v;
      b.setAttribute('aria-label', `Move to vent in ${g.roomName(g.map.vents[v].x, g.map.vents[v].y) || 'hallway'}`);
      b.innerHTML = '<svg viewBox="0 0 40 40"><path d="M6 20h22M20 8l12 12-12 12"/></svg>';
      b.addEventListener('click', () => this.h.onVent(v));
      box.appendChild(b);
    }
    this.positionVentArrows(g, me);
  }

  positionVentArrows(g, me) {
    const [cx, cy] = this.renderer.worldToCss(me.x, me.y - 0.4);
    for (const b of this.el.ventArrows.children) {
      const v = g.map.vents[b.dataset.vent];
      const a = Math.atan2(v.y - me.y, v.x - me.x);
      const r = 90;
      b.style.left = `${cx + Math.cos(a) * r}px`;
      b.style.top = `${cy + Math.sin(a) * r}px`;
      b.style.transform = `translate(-50%, -50%) rotate(${a}rad)`;
    }
  }

  // ---------- map overlay ----------
  get mapOpen() {
    return !!this.mapMode;
  }

  openMap(mode) {
    this.mapMode = mode;
    this.el.mapview.hidden = false;
    this.el.mapview.dataset.mode = mode;
    this.el.mapTitle.textContent = { sabotage: 'Sabotage', admin: 'Admin', cams: 'Security' }[mode] || 'Map';
    this.el.mapCanvas.hidden = mode === 'cams';
    this.el.camsCanvas.hidden = mode !== 'cams';
    if (mode === 'cams' || mode === 'admin') this.h.onWatch?.(mode);
    this.buildMapButtons();
    this.drawMap(0);
  }

  closeMap() {
    const was = this.mapMode;
    this.mapMode = null;
    if (this.el) {
      this.el.mapview.hidden = true;
      this.el.mapButtons.innerHTML = '';
    }
    if (was === 'cams' || was === 'admin') this.h.onWatch?.(null);
  }

  mapScale() {
    const wrap = this.el.mapCanvas.parentElement.getBoundingClientRect();
    const m = this.game.map;
    const s = Math.min(wrap.width / (m.W - 2), wrap.height / (m.H - 2)) || 6;
    return s;
  }

  buildMapButtons() {
    const box = this.el.mapButtons;
    box.innerHTML = '';
    if (this.mapMode !== 'sabotage') return;
    const g = this.game;
    const me = g.local;
    const rectOf = (id) => g.map.rooms.find((r) => r.id === id).rect;
    for (const sab of SAB_TARGETS) {
      const [x0, y0, x1, y1] = rectOf(sab.room);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sab-btn';
      b.dataset.type = sab.type;
      b.dataset.x = (x0 + x1) / 2 + (sab.room === 'reactor' ? 0 : 1.6);
      b.dataset.y = (y0 + y1) / 2 + 1.2;
      b.innerHTML = `${icon(sab.type)}<span>${sab.label}</span>`;
      b.addEventListener('click', () => this.h.onSabotage(sab.type));
      box.appendChild(b);
    }
    if (me.alive) {
      const doorRooms = [...new Set(g.map.doors.map((d) => d.room))];
      for (const room of doorRooms) {
        const [x0, y0, x1, y1] = rectOf(room);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sab-btn door';
        b.dataset.room = room;
        b.dataset.x = room === 'electrical' ? x0 + 2.4 : (x0 + x1) / 2;
        b.dataset.y = room === 'electrical' ? y1 - 2.2 : (y0 + y1) / 2 + 2.6;
        b.innerHTML = `${icon('doors')}<span></span>`;
        b.setAttribute('aria-label', `Close doors: ${g.map.rooms.find((r) => r.id === room).name}`);
        b.addEventListener('click', () => this.h.onDoors(room));
        box.appendChild(b);
      }
    }
  }

  drawMap(time) {
    if (this.mapMode === 'cams') return this.drawCams(time);
    const g = this.game;
    const me = g.local;
    const m = g.map;
    const cv = this.el.mapCanvas;
    const s = this.mapScale();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round((m.W - 2) * s);
    const h = Math.round((m.H - 2) * s);
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      this.el.mapButtons.style.setProperty('--mw', `${w}px`);
      this.el.mapButtons.style.setProperty('--mh', `${h}px`);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, -1 * dpr * s);
    ctx.clearRect(0, 0, m.W, m.H);
    ctx.lineJoin = 'round';
    const areas = [...m.halls, ...m.rooms.map((r) => r.rect)];
    ctx.fillStyle = '#ffffff';
    for (const [x0, y0, x1, y1] of areas) ctx.fillRect(x0 - 0.7, y0 - 0.7, x1 - x0 + 1.4, y1 - y0 + 1.4);
    ctx.fillStyle = this.mapMode === 'sabotage' ? '#b8322e' : '#2f6fb5';
    for (const [x0, y0, x1, y1] of areas) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.font = '800 2px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    for (const r of m.rooms) {
      const [x0, y0, x1] = r.rect;
      ctx.fillText(r.name, (x0 + x1) / 2, y0 + 2);
    }
    const blink = Math.floor(time * 2) % 2 === 0;
    const commsDown = g.sab.active?.type === 'comms';
    const mark = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#07090c';
      ctx.lineWidth = 0.3;
      ctx.font = '900 3px "Baloo 2", sans-serif';
      ctx.strokeText('!', x, y - 0.6);
      ctx.fillText('!', x, y - 0.6);
    };
    if (this.mapMode === 'map' && me.role !== 'impostor' && !commsDown) {
      for (const task of me.tasks) {
        if (task.done || g.t < task.readyAt) continue;
        const st = m.stations[task.steps[task.step].station];
        mark(st.x, st.y, '#f5d90a');
      }
    }
    if (g.sab.active && blink) {
      for (const st of Object.values(m.stations)) if (st.sabotage === g.sab.active.type) mark(st.x, st.y, '#ff3b30');
    }
    if (this.mapMode === 'admin') {
      if (commsDown) {
        ctx.font = '800 3px "Baloo 2", sans-serif';
        ctx.fillStyle = '#ff3b30';
        ctx.fillText('Comms Sabotaged', m.W / 2, m.H / 2);
      } else {
        for (const [ri, n] of g.adminCounts()) {
          const [x0, y0, x1, y1] = m.rooms[ri].rect;
          for (let i = 0; i < n; i++) {
            const cx = (x0 + x1) / 2 - ((n - 1) * 1.3) / 2 + i * 1.3;
            ctx.fillStyle = '#e7edf2';
            ctx.strokeStyle = '#07090c';
            ctx.lineWidth = 0.25;
            ctx.beginPath();
            ctx.roundRect(cx - 0.5, (y0 + y1) / 2 - 0.6, 1, 1.3, 0.45);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }
    // You.
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.scale(2.2 * me.facing, 2.2);
    drawCrewmate(ctx, me.color, me.shadow, -1);
    ctx.restore();

    if (this.mapMode === 'sabotage') {
      const cd = g.sabotageCooldown();
      for (const b of this.el.mapButtons.children) {
        b.style.left = `${Number(b.dataset.x) * s}px`;
        b.style.top = `${(Number(b.dataset.y) - 1) * s}px`;
        if (b.dataset.room) {
          const dc = g.doorCooldown(b.dataset.room);
          b.disabled = dc > 0;
          b.querySelector('span').textContent = dc > 0 ? Math.ceil(dc) : '';
        } else {
          b.disabled = cd > 0;
          b.classList.toggle('active', g.sab.active?.type === b.dataset.type);
          b.title = cd === Infinity ? 'Another sabotage is active' : cd > 0 ? `Ready in ${Math.ceil(cd)}s` : '';
        }
      }
    }
  }

  /** The Security desk: four live camera feeds in a 2x2 grid; static while comms are down. */
  drawCams(time) {
    const g = this.game;
    const cv = this.el.camsCanvas;
    const wrap = cv.parentElement.getBoundingClientRect();
    const gap = 10;
    const fw = Math.max(80, Math.floor(Math.min((wrap.width - gap) / 2, (((wrap.height - gap) / 2) * 16) / 9)));
    const fh = Math.floor((fw * 9) / 16);
    const w = fw * 2 + gap;
    const h = fh * 2 + gap;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const down = g.camsDown();
    const rec = Math.floor(time * 1.5) % 2 === 0;
    g.map.cameras.slice(0, 4).forEach((cam, i) => {
      const x = (i % 2) * (fw + gap);
      const y = Math.floor(i / 2) * (fh + gap);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, fw, fh, 8);
      ctx.clip();
      if (down) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(noise(), x, y, fw, fh);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(this.renderer.renderFeed(cam.view, time), x, y, fw, fh);
      }
      // Screen look: scanlines, a dark rim and a faint green cast.
      ctx.fillStyle = scanlines(ctx);
      ctx.fillRect(x, y, fw, fh);
      const vg = ctx.createRadialGradient(x + fw / 2, y + fh / 2, fh * 0.45, x + fw / 2, y + fh / 2, fw * 0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(x, y, fw, fh);
      ctx.fillStyle = 'rgba(120,255,170,0.05)';
      ctx.fillRect(x, y, fw, fh);
      const fs = Math.max(11, Math.round(fh / 14));
      ctx.font = `800 ${fs}px "Baloo 2", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#07090c';
      ctx.fillStyle = '#ffffff';
      if (down) {
        ctx.textAlign = 'center';
        ctx.strokeText('NO SIGNAL', x + fw / 2, y + fh / 2);
        ctx.fillText('NO SIGNAL', x + fw / 2, y + fh / 2);
      } else if (rec) {
        ctx.textAlign = 'left';
        ctx.beginPath();
        ctx.arc(x + 10 + fs * 0.35, y + 8 + fs * 0.55, fs * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b30';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.strokeText('REC', x + 14 + fs * 0.7, y + 8 + fs * 0.6);
        ctx.fillText('REC', x + 14 + fs * 0.7, y + 8 + fs * 0.6);
      }
      ctx.textAlign = 'left';
      const label = cam.name.toUpperCase();
      ctx.strokeText(label, x + 10, y + fh - 8 - fs * 0.5);
      ctx.fillText(label, x + 10, y + fh - 8 - fs * 0.5);
      ctx.restore();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#07090c';
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, fw - 4, fh - 4, 7);
      ctx.stroke();
    });
  }
}

let noiseCanvas = null;
/** A fresh frame of TV static (small; drawn scaled up). */
function noise() {
  const c = (noiseCanvas ||= Object.assign(document.createElement('canvas'), { width: 160, height: 90 }));
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 40 + Math.random() * 170;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v + 8;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let scanPattern = null;
function scanlines(ctx) {
  if (!scanPattern) {
    const c = Object.assign(document.createElement('canvas'), { width: 1, height: 3 });
    const p = c.getContext('2d');
    p.fillStyle = 'rgba(0,0,0,0.16)';
    p.fillRect(0, 2, 1, 1);
    scanPattern = ctx.createPattern(c, 'repeat');
  }
  return scanPattern;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
