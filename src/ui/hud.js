// In-game HUD modelled on vanilla's Gui.render (1.18).
import { OFFHAND } from '../game/inventory.js';
import { BlockById } from '../registry/blocks.js';
import { BiomeById } from '../registry/biomes.js';
import { MIN_Y, ID_MASK } from '../constants.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.chat = [];              // { text, tick }
    this.actionBar = null;       // { text, ticks }
    this.highlightTicks = 0;
    this.lastSelectedStack = null;
    this.tickCount = 0;
    this.displayHealth = 20; this.lastHealth = 20; this.healthBlinkTime = 0; this.lastHealthTime = 0;
    this.rand = Math.random;
    this.title = null;
  }

  addChat(text) {
    this.chat.push({ text, tick: this.tickCount });
    if (this.chat.length > 100) this.chat.shift();
    console.log('[chat]', text.replace(/§./g, ''));
  }
  setActionBar(text) { this.actionBar = { text, ticks: 60 }; }

  tick() {
    this.tickCount++;
    const p = this.game.player;
    if (!p) return;
    const held = p.inventory.held;
    const key = held ? `${held.id}:${held.tag?.name ?? ''}` : null;
    if (key !== this.lastSelectedStack) { this.highlightTicks = held ? 40 : 0; this.lastSelectedStack = key; }
    else if (this.highlightTicks > 0) this.highlightTicks--;
    if (this.actionBar && --this.actionBar.ticks <= 0) this.actionBar = null;
    if (this.title && --this.title.ticks <= 0) this.title = null;
    // health blink tracking (vanilla uses the player's invulnerable time)
    const h = Math.ceil(p.health);
    if (h < this.lastHealth && p.invulnerableTime > 0) { this.lastHealthTime = this.tickCount; this.healthBlinkTime = this.tickCount + 20; }
    else if (h > this.lastHealth && p.invulnerableTime > 0) { this.lastHealthTime = this.tickCount; this.healthBlinkTime = this.tickCount + 10; }
    if (this.tickCount - this.lastHealthTime > 20) { this.lastHealth = h; this.displayHealth = h; }
    this.lastHealth = h;
  }

  render(gui, partial) {
    const g = this.game, p = g.player;
    if (!p) return;
    const w = gui.width, h = gui.height;
    const settings = g.settings;
    if (g.inGame && !g.screen && g.input.awaitingLock) {
      // lock was refused (e.g. clicked too soon after Esc): ask for a click instead of half-working look
      gui.fill(0, 0, w, h, 'rgba(0,0,0,0.45)');
      gui.textCentered('Click to resume', w / 2, h / 2 - 4, '#ffffff');
      return;
    }
    if (g.hideGui) return;
    this.renderVignette(gui, p);
    if (p.portalTime > 0) this.renderPortalOverlay(gui, p);
    if (p.fireTicks > 0 && !p.creative && !p.spectator && !g.thirdPerson) this.renderFireOverlay(gui);
    if (g.sleepFade > 0) gui.fill(0, 0, w, h, `rgba(0,0,0,${Math.min(1, g.sleepFade / 100) * 0.9})`);
    if (!p.spectator) {
      this.renderCrosshair(gui, p, partial);
      this.renderHotbar(gui, p, partial);
      if (p.survivalLike) {
        this.renderStatusBars(gui, p);
        this.renderXpBar(gui, p);
      }
      // selected item name
      if (this.highlightTicks > 0 && p.inventory.held) {
        const s = p.inventory.held;
        const name = s.tag?.name ?? s.item.display;
        const alpha = Math.min(1, this.highlightTicks * 256 / 10 / 255);
        let y = h - 59;
        if (!p.survivalLike) y += 14;
        gui.ctx.globalAlpha = alpha;
        const x = (w - gui.textWidth(name)) / 2;
        gui.fill(x - 2, y - 2, gui.textWidth(name) + 4, 12, 'rgba(0,0,0,0)');
        gui.text(name, x, y, s.item.rarity === 'rare' || s.tag?.enchantments ? '#55ffff' : s.item.rarity === 'epic' ? '#ff55ff' : '#ffffff', true);
        gui.ctx.globalAlpha = 1;
      }
    }
    if (this.actionBar) {
      const a = Math.min(1, this.actionBar.ticks / 20);
      gui.ctx.globalAlpha = a;
      gui.textCentered(this.actionBar.text, w / 2, h - 68, '#ffffff', true);
      gui.ctx.globalAlpha = 1;
    }
    if (this.title) {
      const c = gui.ctx;
      c.save(); c.globalAlpha = Math.min(1, this.title.ticks / 20); c.scale(4, 4);
      gui.textCentered(this.title.text, w / 8, h / 8 - 10, '#ffffff', true);
      c.restore();
      if (this.title.sub) { c.save(); c.globalAlpha = Math.min(1, this.title.ticks / 20); c.scale(2, 2); gui.textCentered(this.title.sub, w / 4, h / 4 + 5, '#ffffff', true); c.restore(); }
    }
    this.renderChat(gui, !!(g.screen && g.screen.constructor.name === 'ChatScreen'));
    if (g.showDebug) this.renderDebug(gui);
  }

  renderVignette(gui, p) {
    if (this.game.settings.graphics !== 'fancy') return;
    const b = this.game.world.getRawBrightness(Math.floor(p.x), Math.floor(p.y + p.eyeHeight), Math.floor(p.z)) / 15;
    const dark = Math.max(0, Math.min(0.45, (1 - b) * 0.45 + 0.1));
    const w = gui.width, h = gui.height, c = gui.ctx;
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${dark})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  renderPortalOverlay(gui, p) {
    let f = Math.min(1, p.portalTime / 80);
    if (f < 1) f = f * f * f * 0.8 + 0.2;
    const img = this.game.icons.portalFrame(Math.floor(performance.now() / 50));
    const c = gui.ctx;
    c.save();
    c.globalAlpha = f;
    c.imageSmoothingEnabled = false;
    if (img) c.drawImage(img, 0, 0, gui.width, gui.height);
    else { c.fillStyle = 'rgba(120,40,200,0.6)'; c.fillRect(0, 0, gui.width, gui.height); }
    c.restore();
  }

  renderFireOverlay(gui) {
    const img = this.game.icons.fireFrame(Math.floor(performance.now() / 50) % 16);
    if (!img) return;
    const w = gui.width, h = gui.height, c = gui.ctx;
    c.save();
    c.globalAlpha = 0.9;
    const s = Math.min(w, h) * 0.6;
    c.drawImage(img, w * 0.5 - s * 1.05, h - s * 0.75, s, s);
    c.translate(w * 0.5 + s * 1.05, h - s * 0.75); c.scale(-1, 1);
    c.drawImage(img, 0, 0, s, s);
    c.restore();
  }

  renderCrosshair(gui, p, partial) {
    const g = this.game;
    if (g.thirdPerson) return;
    const w = gui.width, h = gui.height, c = gui.ctx;
    if (g.showDebug && !g.hideGui) {
      // RGB axis gizmo like vanilla F3
      const yaw = p.yaw, pitch = p.pitch;
      const cx = w / 2, cy = h / 2, L = 10;
      const proj = (x, y, z) => {
        const cyw = Math.cos(yaw), syw = Math.sin(yaw);
        const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const y1 = y * cp - z1 * sp;
        return [cx + x1 * L, cy - y1 * L];
      };
      for (const [v, col] of [[[1, 0, 0], '#ff0000'], [[0, 1, 0], '#00ff00'], [[0, 0, 1], '#0000ff']]) {
        const e = proj(...v);
        c.strokeStyle = col; c.lineWidth = 1 / gui.scale * 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(e[0], e[1]); c.stroke();
      }
      return;
    }
    c.save();
    c.globalCompositeOperation = 'difference';
    gui.sprite('crosshair', Math.round(w / 2 - 7), Math.round(h / 2 - 7));
    c.restore();
    if (g.settings.attackIndicator === 'crosshair') {
      const f = p.attackStrength(0);
      let full = false;
      const te = g.interaction.targetEntity;
      if (te && te.isLiving && f >= 1) full = p.attackCooldownTicks() > 5 && te.isAlive();
      const x = Math.round(w / 2 - 8), y = Math.round(h / 2 - 7 + 16);
      c.save();
      c.globalCompositeOperation = 'difference';
      if (full) gui.sprite('crosshair_attack_indicator_full', x, y);
      else if (f < 1) {
        gui.sprite('crosshair_attack_indicator_background', x, y);
        const pw = Math.floor(f * 17);
        if (pw > 0) gui.sprite('crosshair_attack_indicator_progress', x, y, 0, 0, pw, 4);
      }
      c.restore();
    }
    void partial;
  }

  renderHotbar(gui, p) {
    const w = gui.width, h = gui.height;
    const inv = p.inventory;
    const x = Math.round(w / 2 - 91), y = h - 22;
    gui.sprite('hotbar', x, y);
    gui.sprite('hotbar_selection', x - 1 + inv.selected * 20, y - 1);
    const off = inv.slots[OFFHAND];
    if (off) gui.sprite('hotbar_offhand_left', x - 29, h - 23);
    for (let i = 0; i < 9; i++) {
      const s = inv.slots[i];
      if (s) this.renderSlotItem(gui, s, x + i * 20 + 3, h - 19, p);
    }
    if (off) this.renderSlotItem(gui, off, x - 26, h - 19, p);
    if (this.game.settings.attackIndicator === 'hotbar') {
      const f = p.attackStrength(0);
      if (f < 1) {
        const ax = x + 182 + 6, ay = h - 20;
        gui.sprite('hotbar_attack_indicator_background', ax, ay);
        const ph = Math.floor(f * 19);
        if (ph > 0) gui.sprite('hotbar_attack_indicator_progress', ax, ay + 18 - ph, 0, 18 - ph, 18, ph);
      }
    }
  }

  renderSlotItem(gui, s, x, y) {
    gui.item(s, x, y);
  }

  renderXpBar(gui, p) {
    const w = gui.width, h = gui.height;
    const x = Math.round(w / 2 - 91);
    gui.sprite('experience_bar_background', x, h - 29);
    const pw = Math.floor(p.xpProgress * 183);
    if (pw > 0) gui.sprite('experience_bar_progress', x, h - 29, 0, 0, Math.min(182, pw), 5);
    if (p.xpLevel > 0) {
      const s = String(p.xpLevel);
      const tx = Math.round((w - gui.textWidth(s)) / 2), ty = h - 35;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) gui.text(s, tx + dx, ty + dy, '#000000', false);
      gui.text(s, tx, ty, '#80ff20', false);
    }
  }

  renderStatusBars(gui, p) {
    const w = gui.width, h = gui.height;
    const t = this.tickCount;
    const health = Math.ceil(p.health);
    const blink = this.healthBlinkTime > t && (this.healthBlinkTime - t) / 3 % 2 === 1;
    const lastH = this.displayHealth;
    const maxH = Math.max(p.maxHealth, Math.max(lastH, health));
    const absorb = Math.ceil(p.absorption);
    const left = Math.round(w / 2 - 91), right = Math.round(w / 2 + 91);
    const top = h - 39;
    const rows = Math.ceil((maxH + absorb) / 2 / 10);
    const rowH = Math.max(10 - (rows - 2), 3);
    const armorTop = top - (rows - 1) * rowH - 10;
    // armor
    const armor = p.armorValue();
    if (armor > 0) {
      for (let i = 0; i < 10; i++) {
        const ax = left + i * 8;
        const n = i * 2 + 1;
        gui.sprite(n < armor ? 'armor_full' : n === armor ? 'armor_half' : 'armor_empty', ax, armorTop);
      }
    }
    // hearts
    const regen = p.hasEffect('regeneration') ? t % Math.ceil(maxH + 5) : -1;
    const kind = p.hasEffect('poison') ? 'poisoned' : p.hasEffect('wither') ? 'withered' : null;
    const hardcore = this.game.worldMeta?.hardcore;
    const total = Math.ceil((maxH + absorb) / 2);
    let absorbLeft = absorb;
    const seed = t * 312871;
    let rnd = seed;
    const nextRand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd; };
    for (let i = total - 1; i >= 0; i--) {
      const row = Math.floor(i / 10);
      const hx = left + (i % 10) * 8;
      let hy = top - row * rowH;
      if (health + absorb <= 4) hy += nextRand() % 2;
      if (absorbLeft <= 0 && i === regen) hy -= 2;
      gui.sprite(blink ? 'heart_container_blinking' : 'heart_container', hx, hy);
      if (hardcore) { /* same container */ }
      if (i * 2 >= maxH) {
        // absorption hearts
        const k = i * 2 - Math.ceil(maxH / 2) * 2;
        void k;
        const rem = absorbLeft;
        if (rem > 0) {
          gui.sprite(rem === 1 && absorb % 2 === 1 ? 'heart_absorbing_half' : 'heart_absorbing_full', hx, hy);
          absorbLeft -= 2;
        }
        continue;
      }
      if (blink) {
        if (i * 2 + 1 < lastH) gui.sprite(kind ? `heart_${kind}_full_blinking` : 'heart_full_blinking', hx, hy);
        else if (i * 2 + 1 === lastH) gui.sprite(kind ? `heart_${kind}_half_blinking` : 'heart_half_blinking', hx, hy);
      }
      if (i * 2 + 1 < health) gui.sprite(kind ? `heart_${kind}_full` : 'heart_full', hx, hy);
      else if (i * 2 + 1 === health) gui.sprite(kind ? `heart_${kind}_half` : 'heart_half', hx, hy);
    }
    // absorption hearts drawn above the health rows when max health is full
    if (absorb > 0 && total * 2 > maxH) { /* handled above */ }
    // food
    const food = p.food.food;
    const hunger = p.hasEffect('hunger');
    for (let i = 0; i < 10; i++) {
      let fy = top;
      if (p.food.saturation <= 0 && t % (food * 3 + 1) === 0) fy += (nextRand() % 3) - 1;
      const fx = right - i * 8 - 9;
      const suf = hunger ? '_hunger' : '';
      gui.sprite('food_empty' + suf, fx, fy);
      if (i * 2 + 1 < food) gui.sprite('food_full' + suf, fx, fy);
      else if (i * 2 + 1 === food) gui.sprite('food_half' + suf, fx, fy);
    }
    // air
    const air = p.air, maxAir = p.maxAir;
    if (p.eyeInWater || air < maxAir) {
      const ay = top - 10;
      const full = Math.ceil((air - 2) * 10 / maxAir), partial = Math.ceil(air * 10 / maxAir) - full;
      for (let i = 0; i < full + partial; i++) {
        gui.sprite(i < full ? 'air' : 'air_bursting', right - i * 8 - 9, ay);
      }
    }
  }

  renderChat(gui, open) {
    const g = this.game;
    const h = gui.height;
    const lines = [];
    const maxW = 320;
    for (let i = this.chat.length - 1; i >= 0 && lines.length < (open ? 20 : 10); i--) {
      const m = this.chat[i];
      const age = this.tickCount - m.tick;
      if (!open && age >= 200) break;
      let a = open ? 1 : Math.max(0, Math.min(1, (200 - age) / 20));
      a = a * a;
      const wrapped = gui.wrap(m.text, maxW - 4);
      for (let k = wrapped.length - 1; k >= 0; k--) lines.push({ text: wrapped[k], a });
    }
    const bottom = h - 48 + (open ? 8 : 0);
    lines.forEach((l, i) => {
      const y = bottom - i * 9;
      gui.fill(0, y - 1, maxW, 9, `rgba(0,0,0,${0.5 * l.a})`);
      gui.ctx.globalAlpha = l.a;
      gui.text(l.text, 2, y, '#ffffff', true);
      gui.ctx.globalAlpha = 1;
    });
    void g;
  }

  renderDebug(gui) {
    const g = this.game, p = g.player, w = g.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const facingIdx = (() => {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? ['east', 'Towards positive X'] : ['west', 'Towards negative X'];
      return fz > 0 ? ['south', 'Towards positive Z'] : ['north', 'Towards negative Z'];
    })();
    const light = w.getLight(bx, Math.floor(p.y + p.eyeHeight), bz);
    const biome = BiomeById[w.getBiome(bx, bz)];
    const mcYaw = ((-p.yaw * 180 / Math.PI + 180) % 360 + 540) % 360 - 180;
    const st = g.renderer.stats;
    let lit = 0, total = 0;
    for (const c of w.chunks.values()) { total++; if (c.state >= 3) lit++; }
    const left = [
      `BlockCraft 1.18.2 (vanilla-like)`,
      `${g.fps} fps T: ${g.settings.maxFps >= 260 ? 'inf' : g.settings.maxFps} ${g.settings.graphics} ${g.settings.clouds === 'off' ? '' : 'fancy-clouds'} B: ${g.settings.viewBobbing ? 1 : 0}`,
      `C: ${st.drawn} sections, ${Math.round(st.triangles / 1000)}k tris, D: ${g.settings.renderDistance}`,
      `E: ${g.entities.list.length}, P: ${g.fx.list.length}`,
      `Chunks: ${lit}/${total} lit, gen queue ${w.pendingLoads}`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${bx & 15} ${(by - MIN_Y) & 15} ${bz & 15} in ${bx >> 4} ${(by - MIN_Y) >> 4} ${bz >> 4}`,
      `Facing: ${facingIdx[0]} (${facingIdx[1]}) (${mcYaw.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
      `Client Light: ${Math.max((light >> 4) - w.skyDarken(), light & 15)} (${light >> 4} sky, ${light & 15} block)`,
      `Biome: blockcraft:${biome?.name ?? 'unknown'}`,
      `Local Difficulty: ${['Peaceful', 'Easy', 'Normal', 'Hard'][w.difficulty]} // Day ${Math.floor(w.time / 24000)}`,
      `Time: ${w.dayTime} ${w.raining ? (w.thundering ? 'thunder' : 'rain') : 'clear'}`,
      `Mode: ${p.gamemode}${p.abilities.flying ? ' (flying)' : ''}`,
    ];
    const target = g.interaction.target;
    const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)}/${Math.round(performance.memory.jsHeapSizeLimit / 1048576)}MB` : 'n/a';
    const right = [
      `JS: browser ${navigator.hardwareConcurrency ?? '?'} threads`,
      `Mem: ${mem}`,
      '',
      `Display: ${g.canvas.width}x${g.canvas.height} (WebGL2)`,
      `${g.renderer.gl.getParameter(g.renderer.gl.VERSION)}`,
      '',
    ];
    if (target) {
      const v = w.getBlock(target.x, target.y, target.z);
      const def = BlockById[v & ID_MASK];
      right.push(`§nTargeted Block: ${target.x}, ${target.y}, ${target.z}`);
      right.push(`blockcraft:${def.name}`);
      if (v >>> 12) right.push(`meta: ${v >>> 12}`);
    }
    if (g.interaction.targetEntity) { right.push(''); right.push(`§nTargeted Entity`); right.push(`blockcraft:${g.interaction.targetEntity.type}`); }
    left.forEach((l, i) => {
      if (!l) return;
      const tw = gui.textWidth(l);
      gui.fill(1, 2 + i * 9 - 1, tw + 2, 9, 'rgba(80,80,80,0.56)');
      gui.text(l, 2, 2 + i * 9, '#e0e0e0', false);
    });
    right.forEach((l, i) => {
      if (!l) return;
      const tw = gui.textWidth(l);
      const x = gui.width - tw - 2;
      gui.fill(x - 1, 2 + i * 9 - 1, tw + 2, 9, 'rgba(80,80,80,0.56)');
      gui.text(l, x, 2 + i * 9, '#e0e0e0', false);
    });
  }
}
