// Menu screens: title, world selection/creation, options, pause, death, loading, chat.
import { Button, CycleButton, Slider, TextField, ScrollList } from './widgets.js';
import { DEFAULT_KEYS } from '../input/input.js';

export class Screen {
  constructor(game) {
    this.game = game;
    this.widgets = [];
    this.title = '';
  }
  get gui() { return this.game.gui; }
  get pausesGame() { return true; }
  get closesOnEsc() { return true; }
  get transparent() { return false; } // world visible behind
  init(w, h) { this.width = w; this.height = h; this.widgets = []; this.build(w, h); }
  build() {}
  add(w) { this.widgets.push(w); return w; }
  tick() {}
  renderBackground(gui) {
    if (this.game.world && this.game.inGame) gui.darkOverlay();
    else gui.dirtBackground();
  }
  render(gui, mx, my, partial) {
    this.renderBackground(gui);
    if (this.title) gui.textCentered(this.title, this.width / 2, 15, '#ffffff', true);
    this.renderContent?.(gui, mx, my, partial);
    for (const w of this.widgets) w.render(gui, mx, my, partial);
    for (const w of this.widgets) if (w.visible && w.tooltip && w.hit(mx, my)) gui.tooltip(Array.isArray(w.tooltip) ? w.tooltip : [w.tooltip], mx, my);
  }
  mouseDown(mx, my, b) {
    for (const w of this.widgets) if (w instanceof TextField) w.focused = false;
    for (const w of [...this.widgets].reverse()) if (w.visible && w.mouseDown(mx, my, b, this.game)) return true;
    return false;
  }
  mouseUp(mx, my, b) { for (const w of this.widgets) w.mouseUp?.(mx, my, b); }
  mouseMove(mx, my) { for (const w of this.widgets) w.mouseDrag?.(mx, my); }
  wheel(d, mx, my) { for (const w of this.widgets) if (w.wheel?.(d, mx, my)) return true; return false; }
  keyDown(e) {
    for (const w of this.widgets) if (w.focused && w.keyDown(e)) return true;
    if (e.code === 'Escape' && this.closesOnEsc) { this.onClose(); return true; }
    if (e.code === 'Tab') {
      const fields = this.widgets.filter((w) => w instanceof TextField && w.visible);
      if (fields.length) {
        const i = fields.findIndex((f) => f.focused);
        fields.forEach((f) => { f.focused = false; });
        fields[(i + 1) % fields.length].focused = true;
        return true;
      }
    }
    return false;
  }
  onClose() { this.game.setScreen(null); }
  removed() {}
}

const SPLASHES = [
  'Blocky!', 'Now with caves & cliffs!', '100% procedural!', 'Punch trees!', 'Also try the real thing!', 'Made in a browser!',
  'Pixel perfect!', 'Creepers are green!', 'Don\'t dig straight down!', 'Diamonds below Y=0!', 'Taller mountains!',
  'Deepslate!', 'Singleplayer!', 'The sweep attack is back!', 'Hold the shield up!', 'Watch your cooldown!', 'Tastes like pixels!',
  '20 ticks per second!', 'Look up at the stars!', 'Try the sunset!', 'WebGL2 powered!', 'Ores are triangular!', 'Now with 384 blocks of height!',
];

export class TitleScreen extends Screen {
  constructor(game) {
    super(game);
    this.splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  }
  get pausesGame() { return false; }
  get closesOnEsc() { return false; }
  build(w, h) {
    const y = h / 4 + 48;
    this.add(new Button(w / 2 - 100, y, 200, 20, 'Singleplayer', () => this.game.setScreen(new SelectWorldScreen(this.game, this))));
    this.add(new Button(w / 2 - 100, y + 24, 200, 20, 'Multiplayer', null, { active: false, tooltip: 'Multiplayer is not available in this version' }));
    this.add(new Button(w / 2 - 100, y + 48, 200, 20, 'How to Play', () => this.game.setScreen(new HelpScreen(this.game, this))));
    this.add(new Button(w / 2 - 100, y + 72 + 12, 98, 20, 'Options...', () => this.game.setScreen(new OptionsScreen(this.game, this))));
    this.add(new Button(w / 2 + 2, y + 72 + 12, 98, 20, 'Quit Game', () => this.game.setScreen(new QuitScreen(this.game, this))));
  }
  renderBackground(gui) {
    if (this.game.panoramaReady) {
      // world panorama is drawn by the 3D renderer underneath; add the soft vanilla gradient
      gui.gradient(0, 0, this.width, this.height, 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.25)');
    } else gui.dirtBackground();
  }
  renderContent(gui) {
    const logo = gui.sprites.get('__logo');
    if (logo) {
      const lw = Math.min(274, this.width - 20);
      const s = lw / logo.width;
      gui.ctx.drawImage(logo, Math.round(this.width / 2 - lw / 2), 30, Math.round(lw), Math.round(logo.height * s));
      // splash text
      const c = gui.ctx;
      c.save();
      c.translate(this.width / 2 + lw / 2 - 30, 30 + logo.height * s - 4);
      c.rotate(-20 * Math.PI / 180);
      let f = 1.8 - Math.abs(Math.sin((performance.now() % 1000) / 1000 * Math.PI * 2) * 0.1);
      f = f * 100 / (gui.textWidth(this.splash) + 32);
      c.scale(f, f);
      gui.textCentered(this.splash, 0, -8, '#ffff00', true);
      c.restore();
    }
    gui.text('BlockCraft 1.18.2', 2, this.height - 10, '#ffffff', true);
    const cr = 'Fan-made game. Not affiliated with Mojang.';
    gui.text(cr, this.width - gui.textWidth(cr) - 2, this.height - 10, '#ffffff', true);
  }
}

export class QuitScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Thanks for playing!'; }
  get pausesGame() { return false; }
  build(w, h) {
    this.add(new Button(w / 2 - 100, h / 2 + 20, 200, 20, 'Back to Title Screen', () => this.game.setScreen(this.parent)));
  }
  renderContent(gui) {
    gui.textCentered('You can close this browser tab now.', this.width / 2, this.height / 2 - 20, '#a0a0a0', true);
    gui.textCentered('Your worlds are saved in this browser.', this.width / 2, this.height / 2 - 8, '#a0a0a0', true);
  }
  onClose() { this.game.setScreen(this.parent); }
}

export class HelpScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'How to Play'; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) { this.add(new Button(w / 2 - 100, h - 27, 200, 20, 'Done', () => this.onClose())); }
  renderContent(gui) {
    const lines = [
      '§eMovement§r: W A S D, Space to jump, Shift to sneak, Ctrl (or double-tap W) to sprint',
      '§eLook§r: mouse (click the game to capture the mouse). Double-tap Space to fly in Creative',
      '§eMine / Attack§r: left mouse button (hold to break blocks)',
      '§ePlace / Use§r: right mouse button (hold to eat, draw bows, raise shields)',
      '§eInventory§r: E    §eDrop§r: Q    §eSwap hands§r: F    §eHotbar§r: 1-9 / mouse wheel',
      '§eChat & commands§r: T or /    §ePause§r: Esc    §eDebug§r: F3    §ePerspective§r: F5',
      '',
      '§6Combat (1.9+)§r: wait for the attack cooldown to refill for full damage.',
      'Falling while attacking = critical hit. Swords sweep nearby mobs.',
      'Sprint-hits knock mobs back. Hold a shield (off hand) to block.',
      '',
      '§6Survival tips§r: punch a tree for wood, craft planks, a crafting table and a',
      'wooden pickaxe. Mine stone, build a shelter before night. Place torches',
      'so monsters cannot spawn (they only spawn in complete darkness).',
      '',
      '§6Commands§r: /gamemode, /time set, /give, /tp, /summon, /weather, /kill, /help',
    ];
    lines.forEach((l, i) => gui.text(l, Math.max(4, this.width / 2 - 170), 36 + i * 11, '#ffffff', true));
  }
  onClose() { this.game.setScreen(this.parent); }
}

// ---------- world selection ----------
class WorldEntry {
  constructor(meta) { this.meta = meta; }
  render(gui, x, y, w, h, mx, my, selected) {
    const m = this.meta;
    gui.text(m.name, x + 3, y + 1, '#ffffff', true);
    const d = new Date(m.lastPlayed || m.created || Date.now());
    const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    gui.text(`${m.name.slice(0, 20)} (${date})`, x + 3, y + 12, '#808080', true);
    const mode = m.hardcore ? '§4Hardcore Mode' : m.gamemode === 'creative' ? 'Creative Mode' : 'Survival Mode';
    gui.text(`${mode}${m.cheats ? ', Cheats' : ''}, Version: 1.18.2`, x + 3, y + 23, '#808080', true);
    void w; void h; void mx; void my; void selected;
  }
}

export class SelectWorldScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Select World'; this.worlds = []; }
  get pausesGame() { return false; }
  build(w, h) {
    this.search = this.add(new TextField(w / 2 - 100, 22, 200, 20, '', { placeholder: 'Search...', onChange: () => this.refresh() }));
    this.list = this.add(new ScrollList(0, 48, w, h - 48 - 64, 36));
    this.list.onSelect = () => this.updateButtons();
    this.list.onDouble = () => this.play();
    this.playBtn = this.add(new Button(w / 2 - 154, h - 52, 150, 20, 'Play Selected World', () => this.play()));
    this.add(new Button(w / 2 + 4, h - 52, 150, 20, 'Create New World', () => this.game.setScreen(new CreateWorldScreen(this.game, this))));
    this.editBtn = this.add(new Button(w / 2 - 154, h - 28, 72, 20, 'Edit', () => this.edit()));
    this.delBtn = this.add(new Button(w / 2 - 76, h - 28, 72, 20, 'Delete', () => this.del()));
    this.recreateBtn = this.add(new Button(w / 2 + 4, h - 28, 72, 20, 'Re-Create', () => this.recreate()));
    this.add(new Button(w / 2 + 82, h - 28, 72, 20, 'Cancel', () => this.onClose()));
    this.load();
  }
  async load() {
    this.worlds = await this.game.storage.listWorlds();
    this.worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    this.refresh();
  }
  refresh() {
    const q = this.search?.value.toLowerCase() ?? '';
    this.list.entries = this.worlds.filter((w) => w.name.toLowerCase().includes(q)).map((m) => new WorldEntry(m));
    if (this.list.selected >= this.list.entries.length) this.list.selected = -1;
    if (this.list.selected < 0 && this.list.entries.length) this.list.selected = 0;
    this.updateButtons();
  }
  updateButtons() {
    const ok = this.list.selected >= 0;
    this.playBtn.active = this.editBtn.active = this.delBtn.active = this.recreateBtn.active = ok;
  }
  selectedMeta() { return this.list.entries[this.list.selected]?.meta; }
  play() { const m = this.selectedMeta(); if (m) this.game.loadWorld(m); }
  edit() {
    const m = this.selectedMeta();
    if (m) this.game.setScreen(new EditWorldScreen(this.game, this, m));
  }
  del() {
    const m = this.selectedMeta();
    if (!m) return;
    this.game.setScreen(new ConfirmScreen(this.game, `Are you sure you want to delete this world?`, `'${m.name}' will be lost forever! (A long time!)`, 'Delete', async (yes) => {
      if (yes) await this.game.storage.deleteWorld(m.id);
      this.game.setScreen(this);
      this.load();
    }));
  }
  recreate() {
    const m = this.selectedMeta();
    if (!m) return;
    const s = new CreateWorldScreen(this.game, this);
    s.preset = { name: m.name + ' (Copy)', seed: String(m.seed), gamemode: m.gamemode, difficulty: m.difficulty, type: m.type, cheats: m.cheats };
    this.game.setScreen(s);
  }
  onClose() { this.game.setScreen(this.parent); }
}

export class EditWorldScreen extends Screen {
  constructor(game, parent, meta) { super(game); this.parent = parent; this.meta = meta; this.title = 'Edit World'; }
  get pausesGame() { return false; }
  build(w, h) {
    this.name = this.add(new TextField(w / 2 - 100, h / 4 + 24, 200, 20, this.meta.name, { maxLength: 32 }));
    this.add(new Button(w / 2 - 100, h / 4 + 144, 98, 20, 'Save', async () => {
      this.meta.name = this.name.value.trim() || this.meta.name;
      await this.game.storage.saveWorldMeta(this.meta);
      this.onClose();
    }));
    this.add(new Button(w / 2 + 2, h / 4 + 144, 98, 20, 'Cancel', () => this.onClose()));
  }
  renderContent(gui) { gui.text('World Name', this.width / 2 - 100, this.height / 4 + 12, '#a0a0a0', true); }
  onClose() { this.game.setScreen(this.parent); this.parent.load?.(); }
}

export class ConfirmScreen extends Screen {
  constructor(game, line1, line2, yesText, cb) { super(game); this.line1 = line1; this.line2 = line2; this.yesText = yesText; this.cb = cb; }
  get pausesGame() { return false; }
  build(w, h) {
    this.add(new Button(w / 2 - 155, h / 6 + 96, 150, 20, this.yesText, () => this.cb(true)));
    this.add(new Button(w / 2 + 5, h / 6 + 96, 150, 20, 'Cancel', () => this.cb(false)));
  }
  renderContent(gui) {
    gui.textCentered(this.line1, this.width / 2, 70, '#ffffff', true);
    gui.textCentered(this.line2, this.width / 2, 90, '#ffffff', true);
  }
  onClose() { this.cb(false); }
}

export class CreateWorldScreen extends Screen {
  constructor(game, parent) {
    super(game);
    this.parent = parent;
    this.title = 'Create New World';
    this.mode = 'survival'; this.difficulty = 2; this.cheats = false; this.type = 'default'; this.seed = ''; this.more = false;
    this.worldName = 'New World';
    this.preset = null;
  }
  get pausesGame() { return false; }
  build(w, h) {
    if (this.preset) {
      Object.assign(this, { worldName: this.preset.name, seed: this.preset.seed, mode: this.preset.gamemode ?? 'survival', difficulty: this.preset.difficulty ?? 2, type: this.preset.type ?? 'default', cheats: !!this.preset.cheats });
      this.preset = null;
    }
    const nameField = this.add(new TextField(w / 2 - 100, 60, 200, 20, this.worldName, { maxLength: 32, onChange: (v) => { this.worldName = v; } }));
    nameField.focused = !this.more;
    this.nameField = nameField;
    const modes = ['survival', 'hardcore', 'creative'];
    const modeBtn = this.add(new CycleButton(w / 2 - 155, 100, 150, 20, 'Game Mode', modes, () => this.mode, (v) => { this.mode = v; if (v === 'creative') this.cheats = true; if (v === 'hardcore') { this.cheats = false; this.difficulty = 3; } }, (v) => v[0].toUpperCase() + v.slice(1)));
    const diffBtn = this.add(new CycleButton(w / 2 + 5, 100, 150, 20, 'Difficulty', [0, 1, 2, 3], () => this.difficulty, (v) => { this.difficulty = v; }, (v) => ['Peaceful', 'Easy', 'Normal', 'Hard'][v]));
    const cheatBtn = this.add(new CycleButton(w / 2 - 155, 151, 150, 20, 'Allow Cheats', [false, true], () => this.cheats, (v) => { this.cheats = v; }, (v) => (v ? 'ON' : 'OFF')));
    this.modeWidgets = [nameField, modeBtn, diffBtn, cheatBtn];
    const moreBtn = this.add(new Button(w / 2 + 5, 151, 150, 20, () => (this.more ? 'Done' : 'More World Options...'), () => { this.more = !this.more; this.init(this.width, this.height); }));
    void moreBtn;
    this.seedField = this.add(new TextField(w / 2 - 100, 60, 200, 20, this.seed, { maxLength: 32, onChange: (v) => { this.seed = v; } }));
    this.typeBtn = this.add(new CycleButton(w / 2 + 5, 100, 150, 20, 'World Type', ['default', 'flat', 'amplified', 'large_biomes'], () => this.type, (v) => { this.type = v; }, (v) => ({ default: 'Default', flat: 'Superflat', amplified: 'Amplified', large_biomes: 'Large Biomes' })[v]));
    this.structBtn = this.add(new CycleButton(w / 2 - 155, 100, 150, 20, 'Generate Structures', [true], () => true, () => {}, (v) => (v ? 'ON' : 'OFF')));
    this.seedField.visible = this.typeBtn.visible = this.structBtn.visible = this.more;
    nameField.visible = modeBtn.visible = diffBtn.visible = cheatBtn.visible = !this.more;
    if (this.more) this.seedField.focused = true;
    this.add(new Button(w / 2 - 155, h - 28, 150, 20, 'Create New World', () => this.create()));
    this.add(new Button(w / 2 + 5, h - 28, 150, 20, 'Cancel', () => this.onClose()));
  }
  renderContent(gui) {
    if (!this.more) {
      gui.text('World Name', this.width / 2 - 100, 47, '#a0a0a0', true);
      gui.text(`Will be saved in: ${this.worldName.replace(/[^a-zA-Z0-9 _-]/g, '_') || 'World'}`, this.width / 2 - 100, 85, '#a0a0a0', true);
      const desc = { survival: 'Search for resources, craft, gain levels, health and hunger', hardcore: 'Same as Survival Mode, locked at hardest difficulty, and one life only', creative: 'Unlimited resources, free flying and destroy blocks instantly' }[this.mode];
      gui.textCentered(desc, this.width / 2, 125, '#a0a0a0', true);
      gui.text('Allow commands like /gamemode, /experience', this.width / 2 - 150, 175, '#a0a0a0', true);
    } else {
      gui.text('Seed for the world generator', this.width / 2 - 100, 47, '#a0a0a0', true);
      gui.text('Leave blank for a random seed', this.width / 2 - 100, 85, '#a0a0a0', true);
    }
  }
  create() {
    this.game.createWorld({
      name: this.worldName.trim() || 'New World', seed: this.seed, gamemode: this.mode === 'creative' ? 'creative' : 'survival',
      hardcore: this.mode === 'hardcore', difficulty: this.difficulty, cheats: this.cheats || this.mode === 'creative', type: this.type,
    });
  }
  onClose() { this.game.setScreen(this.parent); }
}

// ---------- options ----------
export class OptionsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Options'; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) {
    const s = this.game.settings;
    const y0 = h / 6 - 12;
    this.add(new Slider(w / 2 - 155, y0 + 12, 150, 20, (v) => `FOV: ${v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : Math.round(v)}`, () => s.fov, (v) => { s.fov = Math.round(v); this.game.saveSettings(); }, { min: 30, max: 110, step: 1 }));
    if (this.game.world && this.game.inGame) {
      this.add(new CycleButton(w / 2 + 5, y0 + 12, 150, 20, 'Difficulty', [0, 1, 2, 3], () => this.game.world.difficulty, (v) => { if (!this.game.worldMeta?.hardcore) { this.game.world.difficulty = v; this.game.worldMeta.difficulty = v; } }, (v) => ['Peaceful', 'Easy', 'Normal', 'Hard'][v]));
    } else {
      this.add(new CycleButton(w / 2 + 5, y0 + 12, 150, 20, 'Online...', [0], () => 0, () => {}, () => 'Offline')).active = false;
    }
    const bw = 150;
    this.add(new Button(w / 2 - 155, y0 + 48, bw, 20, 'Skin Customization...', null, { active: false }));
    this.add(new Button(w / 2 + 5, y0 + 48, bw, 20, 'Music & Sounds...', () => this.game.setScreen(new SoundOptionsScreen(this.game, this))));
    this.add(new Button(w / 2 - 155, y0 + 72, bw, 20, 'Video Settings...', () => this.game.setScreen(new VideoSettingsScreen(this.game, this))));
    this.add(new Button(w / 2 + 5, y0 + 72, bw, 20, 'Controls...', () => this.game.setScreen(new ControlsScreen(this.game, this))));
    this.add(new Button(w / 2 - 155, y0 + 96, bw, 20, 'Language...', null, { active: false }));
    this.add(new Button(w / 2 + 5, y0 + 96, bw, 20, 'Chat Settings...', null, { active: false }));
    this.add(new Button(w / 2 - 155, y0 + 120, bw, 20, 'Resource Packs...', null, { active: false }));
    this.add(new Button(w / 2 + 5, y0 + 120, bw, 20, 'Accessibility Settings...', () => this.game.setScreen(new AccessibilityScreen(this.game, this))));
    this.add(new Button(w / 2 - 100, h / 6 + 168, 200, 20, 'Done', () => this.onClose()));
  }
  onClose() { this.game.saveSettings(); this.game.setScreen(this.parent); }
}

export class VideoSettingsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Video Settings'; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) {
    const s = this.game.settings;
    const save = () => this.game.saveSettings();
    const items = [
      new CycleButton(0, 0, 150, 20, 'Graphics', ['fast', 'fancy'], () => s.graphics, (v) => { s.graphics = v; save(); }, (v) => (v === 'fast' ? 'Fast' : 'Fancy')),
      new Slider(0, 0, 150, 20, (v) => `Render Distance: ${v} chunks`, () => s.renderDistance, (v) => { s.renderDistance = Math.round(v); save(); }, { min: 2, max: 16, step: 1 }),
      new CycleButton(0, 0, 150, 20, 'Smooth Lighting', [true, false], () => s.smoothLighting, (v) => { s.smoothLighting = v; save(); }, (v) => (v ? 'ON' : 'OFF')),
      new Slider(0, 0, 150, 20, (v) => `Max Framerate: ${v >= 260 ? 'Unlimited' : `${v} fps`}`, () => s.maxFps, (v) => { s.maxFps = Math.round(v); save(); }, { min: 10, max: 260, step: 10 }),
      new CycleButton(0, 0, 150, 20, 'View Bobbing', [true, false], () => s.viewBobbing, (v) => { s.viewBobbing = v; save(); }, (v) => (v ? 'ON' : 'OFF')),
      new CycleButton(0, 0, 150, 20, 'GUI Scale', [0, 1, 2, 3, 4], () => s.guiScale, (v) => { s.guiScale = v; save(); this.game.onResize(); }, (v) => (v === 0 ? 'Auto' : String(v))),
      new CycleButton(0, 0, 150, 20, 'Attack Indicator', ['crosshair', 'hotbar', 'off'], () => s.attackIndicator, (v) => { s.attackIndicator = v; save(); }, (v) => v[0].toUpperCase() + v.slice(1)),
      new Slider(0, 0, 150, 20, (v) => `Brightness: ${v <= 0 ? 'Moody' : v >= 1 ? 'Bright' : `+${Math.round(v * 100)}%`}`, () => s.gamma, (v) => { s.gamma = v; save(); }, { min: 0, max: 1, step: 0.01 }),
      new CycleButton(0, 0, 150, 20, 'Clouds', ['fancy', 'off'], () => s.clouds, (v) => { s.clouds = v; save(); }, (v) => (v === 'off' ? 'OFF' : 'Fancy')),
      new CycleButton(0, 0, 150, 20, 'Fullscreen', [false, true], () => !!document.fullscreenElement, (v) => { this.game.setFullscreen(v); }, (v) => (v ? 'ON' : 'OFF')),
      new CycleButton(0, 0, 150, 20, 'Particles', ['all', 'decreased', 'minimal'], () => s.particles, (v) => { s.particles = v; save(); }, (v) => v[0].toUpperCase() + v.slice(1)),
      new Slider(0, 0, 150, 20, (v) => `FOV Effects: ${Math.round(v * 100)}%`, () => s.fovEffects, (v) => { s.fovEffects = v; save(); }, { min: 0, max: 1, step: 0.01 }),
      new CycleButton(0, 0, 150, 20, 'Entity Shadows', [true, false], () => s.entityShadows, (v) => { s.entityShadows = v; save(); }, (v) => (v ? 'ON' : 'OFF')),
      new Slider(0, 0, 150, 20, (v) => `Mipmap Levels: ${v}`, () => 4, () => {}, { min: 0, max: 4, step: 1 }),
    ];
    this.list = items;
    this.scroll = 0;
    this.layout();
    for (const it of items) this.add(it);
    this.add(new Button(w / 2 - 100, h - 27, 200, 20, 'Done', () => this.onClose()));
  }
  layout() {
    const w = this.width;
    const top = 32;
    this.list.forEach((it, i) => {
      it.x = w / 2 - 155 + (i % 2) * 160;
      it.y = top + Math.floor(i / 2) * 24 - this.scroll;
      it.visible = it.y >= top - 4 && it.y + 20 <= this.height - 32;
    });
  }
  wheel(d) {
    const rows = Math.ceil(this.list.length / 2);
    const max = Math.max(0, rows * 24 - (this.height - 70));
    this.scroll = Math.max(0, Math.min(max, this.scroll + d * 12));
    this.layout();
    return true;
  }
  onClose() { this.game.saveSettings(); this.game.setScreen(this.parent); }
}

export class SoundOptionsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Music & Sound Options'; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) {
    const s = this.game.settings;
    const cats = [['master', 'Master Volume'], ['music', 'Music'], ['records', 'Jukebox/Note Blocks'], ['weather', 'Weather'], ['blocks', 'Blocks'], ['hostile', 'Hostile Creatures'], ['neutral', 'Friendly Creatures'], ['players', 'Players'], ['ambient', 'Ambient/Environment']];
    const y0 = h / 6 - 12;
    cats.forEach(([k, name], i) => {
      const x = i === 0 ? w / 2 - 155 : w / 2 - 155 + ((i - 1) % 2) * 160;
      const y = i === 0 ? y0 : y0 + 24 + Math.floor((i - 1) / 2) * 24;
      const width = i === 0 ? 310 : 150;
      this.add(new Slider(x, y, width, 20, (v) => `${name}: ${v <= 0 ? 'OFF' : Math.round(v * 100) + '%'}`, () => s.volume[k] ?? 1, (v) => { s.volume[k] = v; this.game.applyVolumes(); this.game.saveSettings(); }, { min: 0, max: 1, step: 0.01 }));
    });
    this.add(new CycleButton(w / 2 - 155, y0 + 24 * 6, 150, 20, 'Show Subtitles', [false, true], () => !!s.subtitles, (v) => { s.subtitles = v; this.game.saveSettings(); }, (v) => (v ? 'ON' : 'OFF')));
    this.add(new Button(w / 2 - 100, h / 6 + 168, 200, 20, 'Done', () => this.onClose()));
  }
  onClose() { this.game.setScreen(this.parent); }
}

export class AccessibilityScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Accessibility Settings'; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) {
    const s = this.game.settings;
    const save = () => this.game.saveSettings();
    const y0 = h / 6 - 12;
    this.add(new CycleButton(w / 2 - 155, y0 + 12, 150, 20, 'Sneak', ['hold', 'toggle'], () => s.toggleSneak ? 'toggle' : 'hold', (v) => { s.toggleSneak = v === 'toggle'; save(); }, (v) => v[0].toUpperCase() + v.slice(1)));
    this.add(new CycleButton(w / 2 + 5, y0 + 12, 150, 20, 'Sprint', ['hold', 'toggle'], () => s.toggleSprint ? 'toggle' : 'hold', (v) => { s.toggleSprint = v === 'toggle'; save(); }, (v) => v[0].toUpperCase() + v.slice(1)));
    this.add(new Slider(w / 2 - 155, y0 + 36, 150, 20, (v) => `Screen Effects: ${Math.round(v * 100)}%`, () => s.screenEffects, (v) => { s.screenEffects = v; save(); }, { min: 0, max: 1, step: 0.01 }));
    this.add(new CycleButton(w / 2 + 5, y0 + 36, 150, 20, 'Damage Tilt', [true, false], () => s.damageTilt, (v) => { s.damageTilt = v; save(); }, (v) => (v ? 'ON' : 'OFF')));
    this.add(new Button(w / 2 - 100, h / 6 + 168, 200, 20, 'Done', () => this.onClose()));
  }
  onClose() { this.game.setScreen(this.parent); }
}

class KeyEntry {
  constructor(screen, action, label) { this.screen = screen; this.action = action; this.label = label; }
  render(gui, x, y, w, h, mx, my) {
    const s = this.screen;
    gui.text(this.label, x + 90 - gui.textWidth(this.label), y + 5, '#ffffff', true);
    const bx = x + 105, by = y;
    const hover = mx >= bx && mx < bx + 75 && my >= by && my < by + 20;
    gui.nineSlice(hover ? 'button_highlighted' : 'button', bx, by, 75, 20, 3);
    const code = s.game.input.bindings[this.action];
    let name = keyName(code);
    const dup = Object.entries(s.game.input.bindings).some(([a, c]) => a !== this.action && c === code);
    if (s.waiting === this.action) name = `> ${name} <`;
    gui.textCentered(name, bx + 37, by + 6, s.waiting === this.action ? '#ffff55' : dup ? '#ff5555' : '#ffffff', true);
    const rx = x + 185;
    const changed = code !== DEFAULT_KEYS[this.action];
    gui.nineSlice(changed ? 'button' : 'button_disabled', rx, by, 50, 20, 3);
    gui.textCentered('Reset', rx + 25, by + 6, changed ? '#ffffff' : '#a0a0a0', true);
    this.bx = bx; this.by = by; this.rx = rx;
  }
  mouseDown(mx, my) {
    if (mx >= this.bx && mx < this.bx + 75 && my >= this.by && my < this.by + 20) { this.screen.waiting = this.action; return true; }
    if (mx >= this.rx && mx < this.rx + 50 && my >= this.by && my < this.by + 20) { this.screen.game.input.bindings[this.action] = DEFAULT_KEYS[this.action]; this.screen.game.saveSettings(); return true; }
    return false;
  }
}

function keyName(code) {
  if (!code) return 'NONE';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const m = { ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Control', ControlRight: 'Right Control', Space: 'Space', Tab: 'Tab', Slash: '/', AltLeft: 'Left Alt' };
  return m[code] ?? code;
}

export class ControlsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Controls'; this.waiting = null; }
  get pausesGame() { return !!this.game.inGame; }
  build(w, h) {
    const s = this.game.settings;
    this.add(new Slider(w / 2 - 155, 18, 150, 20, (v) => `Sensitivity: ${Math.round(v * 200)}%`, () => s.sensitivity, (v) => { s.sensitivity = v; this.game.saveSettings(); }, { min: 0, max: 1, step: 0.005 }));
    this.add(new CycleButton(w / 2 + 5, 18, 150, 20, 'Invert Mouse', [false, true], () => s.invertMouse, (v) => { s.invertMouse = v; this.game.saveSettings(); }, (v) => (v ? 'ON' : 'OFF')));
    this.list = this.add(new ScrollList(0, 44, w, h - 44 - 32, 24));
    this.list.rowWidth = 240;
    const labels = {
      forward: 'Walk Forwards', left: 'Strafe Left', back: 'Walk Backwards', right: 'Strafe Right', jump: 'Jump', sneak: 'Sneak', sprint: 'Sprint',
      inventory: 'Open/Close Inventory', drop: 'Drop Selected Item', swapHands: 'Swap Item With Offhand', chat: 'Open Chat', command: 'Open Command',
      perspective: 'Toggle Perspective', debug: 'Debug Screen', hideGui: 'Hide HUD', screenshot: 'Take Screenshot', fullscreen: 'Toggle Fullscreen',
    };
    for (let i = 1; i <= 9; i++) labels[`hotbar${i}`] = `Hotbar Slot ${i}`;
    this.list.entries = Object.entries(labels).map(([a, l]) => new KeyEntry(this, a, l));
    this.add(new Button(w / 2 - 155, h - 28, 150, 20, 'Reset Keys', () => { this.game.input.bindings = { ...DEFAULT_KEYS }; this.game.saveSettings(); }));
    this.add(new Button(w / 2 + 5, h - 28, 150, 20, 'Done', () => this.onClose()));
  }
  keyDown(e) {
    if (this.waiting) {
      this.game.input.bindings[this.waiting] = e.code === 'Escape' ? null : e.code;
      this.waiting = null;
      this.game.saveSettings();
      return true;
    }
    return super.keyDown(e);
  }
  onClose() { this.game.setScreen(this.parent); }
}

// ---------- in-game ----------
export class PauseScreen extends Screen {
  constructor(game) { super(game); this.title = 'Game Menu'; }
  get transparent() { return true; }
  build(w, h) {
    const y = h / 4 + 8;
    this.add(new Button(w / 2 - 102, y, 204, 20, 'Back to Game', () => this.onClose()));
    this.add(new Button(w / 2 - 102, y + 24, 98, 20, 'Advancements', null, { active: false }));
    this.add(new Button(w / 2 + 4, y + 24, 98, 20, 'Statistics', () => this.game.setScreen(new StatsScreen(this.game, this))));
    this.add(new Button(w / 2 - 102, y + 48, 98, 20, 'How to Play', () => this.game.setScreen(new HelpScreen(this.game, this))));
    this.add(new Button(w / 2 + 4, y + 48, 98, 20, 'Give Feedback', null, { active: false }));
    this.add(new Button(w / 2 - 102, y + 72, 98, 20, 'Options...', () => this.game.setScreen(new OptionsScreen(this.game, this))));
    this.add(new Button(w / 2 + 4, y + 72, 98, 20, 'Open to LAN', null, { active: false }));
    this.add(new Button(w / 2 - 102, y + 96, 204, 20, 'Save and Quit to Title', () => this.game.quitToTitle()));
  }
}

export class StatsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.title = 'Statistics'; }
  build(w, h) { this.add(new Button(w / 2 - 100, h - 27, 200, 20, 'Done', () => this.game.setScreen(this.parent))); }
  renderContent(gui) {
    const st = this.game.stats;
    const rows = [
      ['Blocks Mined', st.mined ?? 0], ['Blocks Placed', st.placed ?? 0], ['Mob Kills', st.mobKills ?? 0], ['Deaths', st.deaths ?? 0],
      ['Damage Dealt', Math.round(st.damageDealt ?? 0)], ['Damage Taken', Math.round(st.damageTaken ?? 0)], ['Distance Walked', `${Math.round((st.walked ?? 0) / 10) / 100} km`],
      ['Jumps', st.jumps ?? 0], ['Play Time', `${Math.floor((st.playTicks ?? 0) / 72000)}h ${Math.floor(((st.playTicks ?? 0) % 72000) / 1200)}m`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 40 + i * 12;
      gui.text(k, this.width / 2 - 100, y, '#ffffff', true);
      gui.textRight(String(v), this.width / 2 + 100, y, '#ffffff', true);
    });
  }
  onClose() { this.game.setScreen(this.parent); }
}

export class DeathScreen extends Screen {
  constructor(game, message, hardcore) { super(game); this.message = message; this.hardcore = hardcore; this.delay = 0; }
  get transparent() { return true; }
  get pausesGame() { return false; }
  get closesOnEsc() { return false; }
  build(w, h) {
    this.respawnBtn = this.add(new Button(w / 2 - 100, h / 4 + 72, 200, 20, this.hardcore ? 'Spectate World' : 'Respawn', () => this.game.respawn()));
    this.titleBtn = this.add(new Button(w / 2 - 100, h / 4 + 96, 200, 20, 'Title Screen', () => this.game.quitToTitle()));
    this.respawnBtn.active = this.titleBtn.active = this.delay >= 20;
  }
  tick() {
    this.delay++;
    if (this.delay === 20) { this.respawnBtn.active = true; this.titleBtn.active = true; }
  }
  renderBackground(gui) { gui.gradient(0, 0, this.width, this.height, 'rgba(80,0,0,0.38)', 'rgba(128,48,48,0.63)'); }
  renderContent(gui) {
    const c = gui.ctx;
    c.save(); c.scale(2, 2);
    gui.textCentered(this.hardcore ? 'Game over!' : 'You died!', this.width / 4, 30, '#ffffff', true);
    c.restore();
    if (this.message) gui.textCentered(this.message, this.width / 2, 85, '#ffffff', true);
    gui.textCentered(`Score: §e${this.game.player?.score ?? 0}`, this.width / 2, 100, '#ffffff', true);
  }
}

export class LoadingScreen extends Screen {
  constructor(game, text) { super(game); this.text = text; this.progress = 0; this.chunkGrid = null; }
  get closesOnEsc() { return false; }
  get pausesGame() { return false; }
  renderBackground(gui) { gui.dirtBackground(); }
  renderContent(gui) {
    gui.textCentered(this.text, this.width / 2, this.height / 2 - 50, '#ffffff', true);
    gui.textCentered(`${Math.floor(this.progress * 100)}%`, this.width / 2, this.height / 2 - 36, '#ffffff', true);
    // chunk status grid like vanilla
    const g = this.chunkGrid;
    if (g) {
      const n = g.size, cell = 2;
      const x0 = Math.round(this.width / 2 - n * cell / 2), y0 = Math.round(this.height / 2 - 20);
      gui.fill(x0 - 1, y0 - 1, n * cell + 2, n * cell + 2, '#000000');
      const cols = ['#000000', '#333366', '#557799', '#339933'];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const s = g.states[j * n + i];
        if (s > 0) gui.fill(x0 + i * cell, y0 + j * cell, cell, cell, cols[Math.min(3, s)]);
      }
    }
  }
}

export class SleepScreen extends Screen {
  get transparent() { return true; }
  get pausesGame() { return false; }
  get closesOnEsc() { return false; }
  build(w, h) { this.add(new Button(w / 2 - 100, h - 40, 200, 20, 'Leave Bed', () => this.game.wakeUp())); }
  renderBackground() {}
  keyDown(e) { if (e.code === 'Escape') { this.game.wakeUp(); return true; } return super.keyDown(e); }
}

export class ChatScreen extends Screen {
  constructor(game, initial = '') { super(game); this.initial = initial; this.histIndex = -1; }
  get pausesGame() { return false; }
  get transparent() { return true; }
  build(w, h) {
    this.field = this.add(new TextField(4, h - 12, w - 8, 12, this.initial, { maxLength: 256 }));
    this.field.focused = true;
  }
  renderBackground() {}
  render(gui, mx, my) {
    gui.fill(2, this.height - 14, this.width - 4, 12, 'rgba(0,0,0,0.5)');
    const f = this.field;
    // draw without the black box: vanilla chat input style
    const text = f.value;
    gui.text(text, 4, this.height - 12, '#ffffff', true);
    if (Math.floor(performance.now() / 300) % 2 === 0) {
      const cx = 4 + gui.textWidth(text.slice(0, f.cursor));
      if (f.cursor < text.length) gui.fill(cx, this.height - 13, 1, 10, '#d0d0d0'); else gui.text('_', cx + 1, this.height - 12, '#ffffff', true);
    }
    // command suggestions
    if (text.startsWith('/')) {
      const sug = this.game.commands.suggest(text);
      if (sug.length) {
        const w = Math.max(...sug.map((s) => gui.textWidth(s))) + 4;
        const x = 4 + gui.textWidth(text.slice(0, text.lastIndexOf(' ') + 1));
        sug.slice(0, 10).forEach((s, i) => {
          const y = this.height - 14 - (Math.min(10, sug.length) - i) * 12;
          gui.fill(x - 1, y, w, 12, 'rgba(0,0,0,0.8)');
          gui.text(s, x + 1, y + 2, i === 0 ? '#ffff00' : '#aaaaaa', true);
        });
      }
    }
    void mx; void my;
  }
  keyDown(e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const t = this.field.value.trim();
      if (t) this.game.submitChat(t);
      this.game.setScreen(null);
      return true;
    }
    if (e.code === 'Escape') { this.game.setScreen(null); return true; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const h = this.game.chatHistory;
      if (!h.length) return true;
      if (this.histIndex < 0) this.histIndex = h.length;
      this.histIndex = Math.max(0, Math.min(h.length, this.histIndex + (e.code === 'ArrowUp' ? -1 : 1)));
      this.field.value = h[this.histIndex] ?? '';
      this.field.cursor = this.field.value.length;
      return true;
    }
    if (e.code === 'Tab') {
      const sug = this.game.commands.suggest(this.field.value);
      if (sug.length) {
        const v = this.field.value;
        this.field.value = v.slice(0, v.lastIndexOf(' ') + 1) + sug[0];
        this.field.cursor = this.field.value.length;
      }
      return true;
    }
    return this.field.keyDown(e);
  }
  mouseDown() { return true; }
}
