// Meeting screen: plates, timers, voting, results and chat.

import { bean } from './screens.js';
import { escapeHtml, icon } from './hud.js';
import { sfx } from './audio.js';

export class MeetingUI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    root.hidden = true;
  }

  open(game, myRoom) {
    this.game = game;
    this.myRoom = myRoom;
    this.stage = null;
    this.revealed = false;
    this.unread = 0;
    const me = game.local;
    const m = game.meeting;
    const others = game.players.filter((p) => p.alive && p !== me);
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="meeting">
        <div class="tablet">
          <header>
            <h2>Who is the Impostor?</h2>
            <button class="chat-toggle" type="button" aria-label="Chat">${icon('chat')}<i class="badge" hidden></i></button>
          </header>
          <div class="plates"></div>
          <footer>
            <div class="skip-wrap">
              <button class="skip" type="button">Skip Vote</button>
              <span class="confirm" hidden><button class="yes" type="button" aria-label="Confirm skip">✓</button><button class="no" type="button" aria-label="Cancel">✕</button></span>
              <span class="voters skipped"></span>
            </div>
            <p class="timer"></p>
          </footer>
        </div>
        <aside class="chat">
          <div class="chat-log" aria-live="polite"></div>
          <div class="quick">
            <div class="quick-row">
              ${['Where?', 'Who?', 'Skip', 'I was doing tasks', myRoom ? `I was in ${myRoom}` : 'I was in the hallway'].map((t) => `<button type="button" class="q" data-text="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
            </div>
            <div class="quick-row">
              <select id="accuse" aria-label="Player">${others.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.colorName})</option>`).join('')}</select>
              ${[
                ['is sus', '{n} is sus'],
                ['is safe', '{n} is safe'],
                ['vented', 'I saw {n} vent'],
                ['killed', '{n} killed someone!'],
              ]
                .map(([l, t]) => `<button type="button" class="q acc" data-tpl="${t}">${l}</button>`)
                .join('')}
            </div>
          </div>
          <form class="chat-form" autocomplete="off">
            <input id="chat-input" maxlength="100" placeholder="${me.alive ? 'Type a message' : 'Dead players cannot talk'}" ${me.alive ? '' : 'disabled'}>
            <button type="submit" ${me.alive ? '' : 'disabled'}>Send</button>
          </form>
        </aside>
      </div>`;
    const plates = this.root.querySelector('.plates');
    this.plates = new Map();
    for (const p of game.players) {
      const el = document.createElement('div');
      el.className = 'plate';
      el.dataset.id = p.id;
      el.style.setProperty('--i', String(this.plates.size));
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.classList.toggle('dead', !p.alive);
      el.classList.toggle('me', p === me);
      el.classList.toggle('reporter', p.id === m.callerId);
      el.innerHTML = `<span class="plate-bean"></span><span class="plate-name">${escapeHtml(p.name)}</span>
        <span class="voted">I voted</span><span class="mega">${icon('report')}</span>
        <span class="voters"></span>
        <span class="confirm" hidden><button class="yes" type="button" aria-label="Vote ${escapeHtml(p.name)}">✓</button><button class="no" type="button" aria-label="Cancel">✕</button></span>`;
      el.querySelector('.plate-bean').appendChild(bean(p, 40, { kind: p.alive ? 'alive' : 'ghost' }));
      el.setAttribute('aria-label', `${p.name}, ${p.colorName}${p.alive ? '' : ', dead'}`);
      plates.appendChild(el);
      this.plates.set(p.id, el);
    }
    plates.addEventListener('click', (e) => {
      const plate = e.target.closest('.plate');
      if (!plate) return;
      const id = Number(plate.dataset.id);
      if (e.target.closest('.yes')) return this.cast(id);
      if (e.target.closest('.no')) return this.hideConfirms();
      if (!this.canPick(id)) return;
      this.hideConfirms();
      plate.querySelector('.confirm').hidden = false;
      sfx('click');
    });
    plates.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('plate')) e.target.click();
    });
    const skip = this.root.querySelector('.skip-wrap');
    skip.querySelector('.skip').addEventListener('click', () => {
      if (!this.game.canVote(this.game.local)) return;
      this.hideConfirms();
      skip.querySelector('.confirm').hidden = false;
    });
    skip.querySelector('.yes').addEventListener('click', () => this.cast('skip'));
    skip.querySelector('.no').addEventListener('click', () => this.hideConfirms());

    const form = this.root.querySelector('.chat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      if (input.value.trim()) this.h.onChat(input.value);
      input.value = '';
    });
    this.root.querySelectorAll('.q').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.game.local.alive) return;
        let text = b.dataset.text;
        if (b.dataset.tpl) {
          const id = Number(this.root.querySelector('#accuse').value);
          const p = this.game.players[id];
          if (!p) return;
          text = b.dataset.tpl.replace('{n}', p.colorName);
        }
        this.h.onChat(text);
      }),
    );
    this.root.querySelector('.chat-toggle').addEventListener('click', () => {
      this.root.querySelector('.meeting').classList.toggle('chat-open');
      this.unread = 0;
      this.root.querySelector('.badge').hidden = true;
    });
    for (const msg of m.chat) this.addChat(msg);
    this.update();
  }

  canPick(id) {
    const g = this.game;
    const target = g.players[id];
    return g.canVote(g.local) && target.alive;
  }

  hideConfirms() {
    this.root.querySelectorAll('.confirm').forEach((c) => (c.hidden = true));
  }

  cast(target) {
    this.hideConfirms();
    this.h.onVote(target);
  }

  addChat(msg) {
    if (!this.game) return;
    const me = this.game.local;
    if (msg.dead && me.alive) return;
    const p = this.game.players[msg.from];
    const log = this.root.querySelector('.chat-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = `msg${p === me ? ' mine' : ''}${msg.dead ? ' ghost' : ''}`;
    row.innerHTML = `<span class="msg-bean"></span><div class="bubble"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(msg.text)}</span></div>`;
    row.querySelector('.msg-bean').appendChild(bean(p, 30, { kind: p.alive ? 'alive' : 'ghost' }));
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    if (!this.root.querySelector('.meeting').classList.contains('chat-open') && p !== me) {
      this.unread++;
      const badge = this.root.querySelector('.badge');
      badge.hidden = false;
      badge.textContent = this.unread;
    }
    if (p !== me) sfx('chat');
  }

  update() {
    const g = this.game;
    const m = g?.meeting;
    if (!m || this.root.hidden) return;
    const me = g.local;
    const timer = this.root.querySelector('.timer');
    const left = Math.max(0, Math.ceil(m.stageEnd - g.t));
    if (m.stage === 'discussion') timer.textContent = `Voting begins in ${left}s`;
    else if (m.stage === 'voting')
      timer.textContent = me.vote != null || !me.alive ? `Voting ends in ${left}s` : `Vote now! Voting ends in ${left}s`;
    else if (m.stage === 'results') timer.textContent = 'Voting results';
    else timer.textContent = '';
    const voting = m.stage === 'voting';
    this.root.querySelector('.meeting').classList.toggle('can-vote', g.canVote(me));
    this.root.querySelector('.skip').disabled = !g.canVote(me);
    for (const p of g.players) {
      const el = this.plates.get(p.id);
      el.classList.toggle('has-voted', p.vote != null && voting);
      el.classList.toggle('picked', me.vote === p.id);
    }
    if (m.stage !== 'voting') this.hideConfirms();
    if (m.stage === 'results' && !this.revealed) this.reveal();
  }

  reveal() {
    this.revealed = true;
    const g = this.game;
    const anon = g.settings.anonymousVotes;
    const voters = g.players.filter((p) => p.alive && p.vote != null);
    voters.forEach((p, i) => {
      setTimeout(
        () => {
          if (!this.game || this.root.hidden) return;
          const box = p.vote === 'skip' ? this.root.querySelector('.voters.skipped') : this.plates.get(p.vote)?.querySelector('.voters');
          if (!box) return;
          const icon = anon ? bean({ color: '#8c96a0', shadow: '#5d6670' }, 22) : bean(p, 22);
          box.appendChild(icon);
          sfx('vote');
        },
        250 + i * 220,
      );
    });
    const r = g.meeting.result;
    if (r.ejected != null) this.plates.get(r.ejected)?.classList.add('ejected');
  }

  close() {
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.game = null;
  }
}
