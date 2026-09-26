// Game: owns the world, player, renderer, UI and main loop (20 ticks per second, interpolated rendering).
import { TICK_MS, ID_MASK, packBlock, MIN_Y, SECTION_COUNT } from '../constants.js';
import { BlockById, B, collectBlockTextureNames } from '../registry/blocks.js';
import { Items, ItemById } from '../registry/items.js';
import { SMELTING } from '../registry/recipes.js';
import { World, SB_ALL } from '../world/world.js';
import { CS_LIT } from '../world/chunk.js';
import { GeneratorPool } from '../world/genpool.js';
import { Storage } from '../world/storage.js';
import { Renderer } from '../render/renderer.js';
import { BlockTextureArray } from '../render/textureArray.js';
import { ObjectRenderer } from '../render/objects.js';
import { Effects } from '../render/particles.js';
import { IconCache } from '../render/icons.js';
import { Gui, imageToCanvas } from '../ui/gui.js';
import { Hud } from '../ui/hud.js';
import { IntroScreen } from '../ui/intro.js';
import { TitleScreen, PauseScreen, DeathScreen, LoadingScreen, ChatScreen, SleepScreen } from '../ui/screens.js';
import { InventoryScreen, CreativeScreen, CraftingScreen, FurnaceScreen, ChestScreen, EnchantmentScreen, AnvilScreen, fuelOf } from '../ui/containers.js';
import { Input } from '../input/input.js';
import { Player } from '../entity/player.js';
import { EntityManager } from '../entity/manager.js';
import { MOB_TYPES } from '../entity/mobs.js';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt, Arrow, ThrownItem, explode } from '../entity/objects.js';
import { ItemStack, Inventory } from './inventory.js';
import { Interaction } from './interaction.js';
import { BlockLogic } from './blocklogic.js';
import { Commands } from './commands.js';
import { findNearbyPortal, createPortal } from './portal.js';
import '../entity/nethermobs.js';
import { stringSeed, hash4 } from '../util/rng.js';
import { clamp, mat4 } from '../util/math.js';
import { generateBlockTextures } from '../textures/blockTextures.js';
import { generateItemTextures } from '../textures/itemTextures.js';
import { generateGuiTextures } from '../textures/guiTextures.js';
import { generateEntityTextures } from '../textures/entityTextures.js';
import { generateParticleTextures } from '../textures/particleTextures.js';
import { generateEnvironmentTextures } from '../textures/environmentTextures.js';
import { renderTitleLogo } from '../textures/logo.js';
import { SoundManager } from '../audio/sound.js';

const DEFAULT_SETTINGS = {
  fov: 70, renderDistance: 8, maxFps: 260, viewBobbing: true, guiScale: 0, gamma: 0.5, clouds: 'fancy', graphics: 'fancy',
  smoothLighting: true, attackIndicator: 'crosshair', sensitivity: 0.5, invertMouse: false, particles: 'all', fovEffects: 1,
  entityShadows: true, toggleSneak: false, toggleSprint: false, screenEffects: 1, damageTilt: true, advancedTooltips: false,
  volume: { master: 1, music: 1, records: 1, weather: 1, blocks: 1, hostile: 1, neutral: 1, players: 1, ambient: 1 }, keys: null,
};

const DEATH_MESSAGES = {
  fall: 'Player fell from a high place', drown: 'Player drowned', lava: 'Player tried to swim in lava', fire: 'Player burned to death',
  in_fire: 'Player went up in flames', starve: 'Player starved to death', suffocate: 'Player suffocated in a wall', void: 'Player fell out of the world',
  cactus: 'Player was pricked to death', magic: 'Player was killed by magic', wither: 'Player withered away', kill: 'Player died',
  explosion: 'Player blew up', sweet_berry: 'Player was poked to death by a sweet berry bush', generic: 'Player died',
};

export class Game {
  constructor(canvas, uiCanvas) {
    this.canvas = canvas;
    this.uiCanvas = uiCanvas;
    this.screen = null;
    this.world = null;
    this.player = null;
    this.inGame = false;
    this.paused = false;
    this.settings = loadSettings();
    this.stats = {};
    this.chatHistory = [];
    this.showDebug = false;
    this.hideGui = false;
    this.thirdPerson = 0; // 0 first person, 1 back, 2 front
    this.fps = 0;
    this.handState = { oMain: 0, main: 0, oOff: 0, off: 0, mainHeight: 0, offHeight: 0, lastMain: null, lastOff: null };
    this.fovMod = 1; this.oFovMod = 1;
    this.eyeHeight = 1.62; this.oEyeHeight = 1.62;
    this.spawners = new Map();
    this.sleepFade = 0;
    this.playerPreview = null;
    this.lastJumpTap = -100; this.lastForwardTap = -100;
    this.tickCount = 0;
    this.lastSave = 0;
  }

  // ---------- startup ----------
  async init(progress = () => {}) {
    progress('Generating textures', 0.05);
    await nextFrame();
    const blockTex = generateBlockTextures();
    progress('Generating textures', 0.3);
    await nextFrame();
    const itemTex = generateItemTextures();
    const guiTex = generateGuiTextures();
    const entityTex = generateEntityTextures();
    const particleTex = generateParticleTextures();
    const envTex = generateEnvironmentTextures();
    this.blockTexMap = blockTex;
    this.itemTexMap = itemTex;
    progress('Starting renderer', 0.6);
    await nextFrame();
    this.renderer = new Renderer(this.canvas, (gl) => new BlockTextureArray(gl, blockTex), envTex);
    const weatherTex = new Map([['rain', envTex.get('rain')], ['snow', envTex.get('snow')]].filter(([, v]) => v));
    this.objects = new ObjectRenderer(this.renderer, { itemTextures: itemTex, entityTextures: entityTex, particleTextures: particleTex, weatherTextures: weatherTex });
    this.objects.game = this;
    this.renderer.extraRenderers.push(this.objects);
    this.fx = new Effects(this);
    this.gui = new Gui(this.uiCanvas);
    this.gui.setSprites(guiTex);
    this.gui.sprites.set('__logo', imageToCanvas(renderTitleLogo('BLOCKCRAFT')));
    this.icons = new IconCache({ objects: this.objects, blockTexMap: blockTex, itemTexMap: itemTex });
    this.gui.icons = this.icons;
    this.sound = new SoundManager();
    this.applyVolumes();
    this.input = new Input(this.uiCanvas);
    if (this.settings.keys) Object.assign(this.input.bindings, this.settings.keys);
    this.input.onCaptureChange = (captured) => { if (!captured && this.inGame && !this.screen) this.setScreen(new PauseScreen(this)); };
    progress('Opening save storage', 0.8);
    this.storage = await Storage.open();
    this.hud = new Hud(this);
    this.commands = new Commands(this);
    this.interaction = new Interaction(this);
    this.blockLogic = new BlockLogic(this);
    this.entities = new EntityManager(this);
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.saveGame(); if (this.inGame && !this.screen) this.setScreen(new PauseScreen(this)); } });
    window.addEventListener('beforeunload', () => this.saveGame());
    const unlock = () => { this.sound.unlock(); if (!this.musicStarted) { this.musicStarted = true; this.sound.startMusic(this.inGame ? 'game' : 'menu'); } };
    window.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
    this.onResize();
    progress('Done', 1);
    this.setScreen(new IntroScreen(this));
    this.startPanorama();
    this.last = performance.now();
    this.acc = 0;
    this.frameCount = 0; this.fpsTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    this.renderer.resize(w, h);
    this.gui.resize(w, h, this.settings.guiScale);
    this.icons.renderBlockIcons(Math.max(16, 16 * this.gui.scale));
    if (this.screen) this.screen.init(this.gui.width, this.gui.height);
  }

  saveSettings() {
    this.settings.keys = { ...this.input.bindings };
    try { localStorage.setItem('blockcraft.settings', JSON.stringify(this.settings)); } catch (e) { /* storage blocked */ }
  }
  applyVolumes() { for (const [k, v] of Object.entries(this.settings.volume)) this.sound.setVolume(k, v); }
  setFullscreen(on) {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen?.();
  }

  setScreen(s) {
    if (this.screen) this.screen.removed?.();
    this.screen = s;
    this.playerPreview = null;
    if (s) {
      s.init(this.gui.width, this.gui.height);
      this.input.release();
    } else if (this.inGame) {
      this.input.capture();
    }
  }

  // ---------- title screen panorama ----------
  startPanorama() {
    if (this.panorama) return;
    try {
      const gen = new GeneratorPool(3, { type: 'default' });
      const world = new World({ seed: 3, name: 'panorama', generator: gen });
      world.game = { fx: null };
      world.dayTime = 3000;
      const sp = gen.getSpawnPoint();
      this.panorama = { world, gen, x: sp.x + 0.5, y: sp.y + 12, z: sp.z + 0.5, yaw: 0 };
    } catch (e) { console.warn('panorama failed', e); }
  }
  stopPanorama() {
    if (!this.panorama) return;
    for (const c of this.panorama.world.chunks.values()) this.renderer.freeChunk(c);
    this.panorama.gen.destroy();
    this.panorama = null;
    this.panoramaReady = false;
  }

  // ---------- worlds ----------
  async createWorld(opts) {
    const seed = opts.seed && opts.seed.trim() ? stringSeed(opts.seed) : (Math.random() * 2 ** 31) | 0;
    const meta = {
      id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: opts.name, seed, gamemode: opts.gamemode,
      hardcore: !!opts.hardcore, difficulty: opts.difficulty, cheats: !!opts.cheats, type: opts.type ?? 'default', created: Date.now(), lastPlayed: Date.now(),
    };
    await this.storage.saveWorldMeta(meta);
    this.startWorld(meta, true);
  }
  async loadWorld(meta) {
    const fresh = await this.storage.getWorld(meta.id);
    this.startWorld(fresh ?? meta, false);
  }

  startWorld(meta, isNew) {
    this.stopPanorama();
    this.worldMeta = meta;
    meta.portals = meta.portals ?? { overworld: [], nether: [] };
    this.stats = meta.stats ?? {};
    this.hud = new Hud(this);
    this.interaction = new Interaction(this);
    this.thirdPerson = 0;
    const player = new Player(null);
    this.player = player;
    const restore = !!meta.player && !isNew;
    if (restore) player.deserialize(meta.player);
    else { player.setGamemode(meta.gamemode ?? 'survival'); player.yaw = Math.PI; }
    this.worldTime = { time: meta.time ?? 0, dayTime: meta.dayTime ?? 1000, raining: !!meta.raining, thundering: !!meta.thundering, weatherTimer: meta.weatherTimer };
    const dim = restore ? meta.dimension ?? 'overworld' : 'overworld';
    this.sound.stopMusic();
    this.enterDimension(dim, restore ? { kind: 'restore' } : { kind: 'spawn' }, isNew ? 'Generating world' : 'Loading world');
  }

  // Create the World object for a dimension of the current save.
  makeDimensionWorld(dim) {
    const meta = this.worldMeta;
    const gen = new GeneratorPool(meta.seed, { type: meta.type, dimension: dim });
    const id = dim === 'overworld' ? meta.id : `${meta.id}:${dim}`;
    const world = new World({ seed: meta.seed, name: meta.name, type: meta.type, generator: gen, storage: this.storage, id });
    world.dimension = dim;
    world.ultrawarm = dim === 'nether';
    world.hasSky = dim === 'overworld';
    world.game = this;
    world.behavior = this.blockLogic;
    world.difficulty = meta.hardcore ? 3 : meta.difficulty ?? 2;
    if (meta.gamerules) Object.assign(world.gamerules, meta.gamerules);
    const wt = this.worldTime;
    world.time = wt.time; world.dayTime = wt.dayTime;
    if (dim === 'overworld') {
      world.raining = wt.raining; world.thundering = wt.thundering;
      if (wt.weatherTimer) world.weatherTimer = wt.weatherTimer;
      world.rain = world.raining ? 1 : 0; world.thunder = world.thundering ? 1 : 0;
    } else { world.gamerules = { ...world.gamerules, doWeatherCycle: false }; }
    world.entityHooks = {
      onChunkLit: (c) => { this.entities.onChunkLit(c); this.scanSpawners(c); },
      onChunkLoaded: (c, data) => this.entities.loadChunkEntities(data.entities),
      collectChunkEntities: (c) => this.entities.collectChunkEntities(c),
      onChunkUnload: (c) => {
        this.entities.onChunkUnload(c);
        for (const map of [this.spawners, this.enchTables]) for (const k of map.keys()) { const [x, , z] = k.split(',').map(Number); if ((x >> 4) === c.cx && (z >> 4) === c.cz) map.delete(k); }
      },
    };
    world.onChunkUnload = (c) => this.renderer.freeChunk(c);
    if (meta.spawn && dim === 'overworld') world.spawn = meta.spawn;
    return world;
  }

  // Leave the current dimension (saving it) and load another one. arrival: { kind: 'spawn'|'restore'|'portal'|'respawn', x, y, z }
  async enterDimension(dim, arrival, text = 'Loading terrain') {
    if (this.world) {
      this.inGame = false;
      const old = this.world;
      this.worldTime = { time: old.time, dayTime: old.dayTime, raining: old.dimension === 'overworld' ? old.raining : this.worldTime.raining, thundering: old.dimension === 'overworld' ? old.thundering : this.worldTime.thundering, weatherTimer: old.weatherTimer };
      if (this.rainSound) { this.rainSound.stop?.(); this.rainSound = null; }
      this.stopAmbientLoop();
      this.world = null;
      await this.unloadWorld(old);
    }
    const world = this.makeDimensionWorld(dim);
    this.world = world;
    this.genPool = world.generator;
    this.dimension = dim;
    this.entities = new EntityManager(this);
    this.fx = new Effects(this);
    this.spawners = new Map();
    this.enchTables = new Map();
    const p = this.player;
    p.world = world;
    if (arrival.kind === 'spawn' || arrival.kind === 'respawn') {
      if (!this.worldMeta.spawn) {
        const sp = this.genPool.getSpawnPoint();
        this.worldMeta.spawn = { x: sp.x, y: sp.y, z: sp.z };
      }
      world.spawn = this.worldMeta.spawn;
      const pos = arrival.pos ?? { x: world.spawn.x + 0.5, y: world.spawn.y, z: world.spawn.z + 0.5 };
      p.setPos(pos.x, pos.y, pos.z);
    } else if (arrival.kind === 'portal') {
      p.setPos(arrival.x + 0.5, arrival.y, arrival.z + 0.5);
    }
    p.vx = p.vy = p.vz = 0;
    this.entities.add(p);
    this.inGame = false;
    this.loading = { screen: new LoadingScreen(this, text), started: performance.now(), arrival };
    this.setScreen(this.loading.screen);
  }

  async unloadWorld(w) {
    try {
      await this.storage.saveWorldMeta(this.collectMeta(w));
      for (const c of [...w.chunks.values()]) {
        if ((c.modified || this.entities.collectChunkEntities(c).length) && c.state >= 2) await this.storage.saveChunk(w.id, c, this.entities.collectChunkEntities(c));
        this.renderer.freeChunk(c);
      }
    } catch (e) { console.warn('saving dimension failed', e); }
    w.generator.destroy();
    w.chunks.clear();
  }

  // called every frame while the loading screen is up
  updateLoading() {
    const L = this.loading;
    const w = this.world, p = this.player;
    const r = 2;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    let ready = 0, total = 0;
    const n = 2 * (r + 3) + 1;
    const grid = { size: n, states: new Uint8Array(n * n) };
    for (let dz = -(r + 3); dz <= r + 3; dz++) for (let dx = -(r + 3); dx <= r + 3; dx++) {
      const c = w.getChunk(pcx + dx, pcz + dz);
      grid.states[(dz + r + 3) * n + dx + r + 3] = c ? c.state + 0 : 0;
      if (Math.abs(dx) <= r && Math.abs(dz) <= r) { total++; if (c && c.state >= CS_LIT && c.dirty.size === 0 && !w.dirtyChunks.has(c)) ready++; }
    }
    L.screen.chunkGrid = grid;
    L.screen.progress = Math.min(0.99, ready / total);
    const elapsed = performance.now() - L.started;
    if (ready >= total || elapsed > 30000) this.finishLoading();
  }

  finishLoading() {
    const p = this.player, w = this.world;
    const arrival = this.loading.arrival ?? { kind: 'spawn' };
    if (arrival.kind === 'portal') this.placeAtPortal(arrival);
    else if (arrival.kind === 'respawn' && arrival.checkBed) { const pos = this.findRespawnPos(); p.setPos(pos.x, pos.y, pos.z); }
    else if (arrival.kind !== 'restore') {
      // make sure the player isn't stuck inside terrain at spawn
      let y = Math.floor(p.y);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      for (let i = 0; i < 64 && (BlockById[w.getBlockId(x, y, z)].solid || BlockById[w.getBlockId(x, y + 1, z)].solid); i++) y++;
      p.setPos(p.x, y, p.z);
    }
    const first = !this.inGameOnce;
    this.inGameOnce = true;
    this.loading = null;
    this.inGame = true;
    this.setScreen(null);
    if (first && this.worldMeta.hardcore) this.hud.addChat('§cHardcore mode: you only get one life!');
    this.sound.startMusic(w.dimension === 'nether' ? 'nether' : 'game');
    this.saveGame();
  }

  // ---------- nether portals ----------
  checkPortal() {
    const p = this.player, w = this.world;
    const b = p.aabb();
    let inPortal = false;
    for (let x = Math.floor(b[0]); x <= Math.floor(b[3]) && !inPortal; x++)
      for (let y = Math.floor(b[1]); y <= Math.floor(b[4]) && !inPortal; y++)
        for (let z = Math.floor(b[2]); z <= Math.floor(b[5]) && !inPortal; z++)
          if (w.getBlockId(x, y, z) === B.nether_portal) inPortal = true;
    p.inPortal = inPortal;
    if (inPortal && !p.dead) {
      if (p.portalCooldown > 0) { p.portalCooldown = 10; return; }
      if (p.portalTime === 0) this.sound.play('block.portal.trigger', { volume: 0.25, pitch: Math.random() * 0.4 + 0.8 });
      p.portalTime++;
      const wait = p.creative || p.spectator ? 1 : 80;
      if (p.portalTime >= wait) {
        p.portalTime = 0;
        p.portalCooldown = 10;
        this.travelThroughPortal();
      }
    } else {
      if (p.portalCooldown > 0) p.portalCooldown--;
      p.portalTime = Math.max(0, p.portalTime - 4);
    }
  }

  travelThroughPortal() {
    const p = this.player, from = this.world.dimension;
    const to = from === 'nether' ? 'overworld' : 'nether';
    const scale = to === 'nether' ? 1 / 8 : 8;
    const tx = Math.floor(p.x * scale), tz = Math.floor(p.z * scale);
    const ty = to === 'nether' ? Math.max(32, Math.min(120, Math.floor(p.y))) : Math.floor(p.y);
    this.registerPortalNear(from, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    // prefer a known portal close to the target
    const list = this.worldMeta.portals[to] ?? [];
    const radius = to === 'nether' ? 16 : 128;
    let known = null, bd = Infinity;
    for (const q of list) {
      if (Math.abs(q.x - tx) > radius || Math.abs(q.z - tz) > radius) continue;
      const d = (q.x - tx) ** 2 + (q.z - tz) ** 2;
      if (d < bd) { bd = d; known = q; }
    }
    const arrival = known ? { kind: 'portal', x: known.x, y: known.y, z: known.z, known: true } : { kind: 'portal', x: tx, y: ty, z: tz, known: false };
    this.enterDimension(to, arrival, to === 'nether' ? 'Entering the Nether' : 'Leaving the Nether');
  }

  registerPortalNear(dim, x, y, z) {
    const list = this.worldMeta.portals[dim] = this.worldMeta.portals[dim] ?? [];
    if (list.some((q) => Math.abs(q.x - x) < 4 && Math.abs(q.y - y) < 4 && Math.abs(q.z - z) < 4)) return;
    list.push({ x, y, z });
  }

  placeAtPortal(arrival) {
    const w = this.world, p = this.player;
    const yMin = w.dimension === 'nether' ? 1 : MIN_Y + 1, yMax = w.dimension === 'nether' ? 122 : 300;
    let portal = findNearbyPortal(w, arrival.x, arrival.y, arrival.z, arrival.known ? 16 : (w.dimension === 'nether' ? 16 : 32), yMin, yMax);
    if (!portal) {
      portal = createPortal(w, arrival.x, arrival.y, arrival.z, yMin, yMax);
      this.registerPortalNear(w.dimension, portal.x, portal.y, portal.z);
    }
    p.setPos(portal.x + 0.5, portal.y, portal.z + 0.5);
    p.fallDistance = 0;
    p.portalCooldown = 10;
    this.sound.play('block.portal.travel', { volume: 0.25, pitch: Math.random() * 0.4 + 0.8 });
  }

  collectMeta(w = this.world) {
    const m = this.worldMeta;
    m.lastPlayed = Date.now();
    m.time = w.time; m.dayTime = w.dayTime;
    if (w.dimension === 'overworld') { m.raining = w.raining; m.thundering = w.thundering; m.weatherTimer = w.weatherTimer; m.spawn = w.spawn; }
    const rules = { ...w.gamerules };
    if (w.dimension !== 'overworld') delete rules.doWeatherCycle;
    m.gamerules = { ...(m.gamerules ?? {}), ...rules };
    m.difficulty = w.difficulty;
    m.dimension = w.dimension;
    m.player = this.player.serialize();
    m.stats = this.stats;
    m.gamemode = this.player.gamemode;
    return m;
  }

  async saveGame() {
    if (!this.world || !this.inGame || this.saving) return;
    this.saving = true;
    try {
      await this.storage.saveWorldMeta(this.collectMeta());
      await this.world.saveAll();
    } catch (e) { console.warn('save failed', e); }
    this.saving = false;
  }

  async quitToTitle() {
    this.setScreen(new LoadingScreen(this, 'Saving world'));
    this.inGame = false;
    if (this.rainSound) { this.rainSound.stop?.(); this.rainSound = null; }
    this.stopAmbientLoop();
    const w = this.world;
    this.world = null;
    if (w) await this.unloadWorld(w);
    this.player = null; this.inGameOnce = false;
    this.entities = new EntityManager(this);
    this.sound.stopMusic();
    this.setScreen(new TitleScreen(this));
    this.startPanorama();
    this.sound.startMusic('menu');
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const maxFps = this.settings.maxFps;
    if (maxFps < 260 && now - (this.lastFrame ?? 0) < 1000 / maxFps - 1) return;
    this.lastFrame = now;
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = 250;
    this.frameCount++;
    if (now - this.fpsTime >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTime = now; }
    this.processInput();
    const paused = this.inGame && this.screen && this.screen.pausesGame;
    if (this.inGame && !paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_MS && n < 10) { this.tick(); this.acc -= TICK_MS; n++; }
    } else if (this.screen) {
      this.acc = Math.min(this.acc, TICK_MS);
      this.uiTick = (this.uiTick ?? 0) + dt;
      while (this.uiTick >= TICK_MS) { this.uiTick -= TICK_MS; this.screen.tick?.(); }
    }
    const partial = this.inGame && !paused ? this.acc / TICK_MS : 1;
    try { this.renderFrame(partial, dt); } catch (e) { console.error(e); }
    this.input.endFrame();
  }

  // ---------- input ----------
  processInput() {
    const inp = this.input;
    const events = inp.consumeEvents();
    const g = this.gui;
    for (const e of events) {
      const s = this.screen;
      const mx = e.x / g.scale, my = e.y / g.scale;
      if (s) {
        if (e.type === 'mousedown') s.mouseDown(mx, my, e.button, e.shift);
        else if (e.type === 'mouseup') s.mouseUp(mx, my, e.button);
        else if (e.type === 'mousemove') s.mouseMove(mx, my);
        else if (e.type === 'wheel') s.wheel(e.delta, mx, my);
        else if (e.type === 'keydown') {
          if (!s.keyDown(e) && this.inGame) this.globalKey(e);
          else if (!this.inGame && e.code === 'F11') this.setFullscreen(!document.fullscreenElement);
        }
        continue;
      }
      if (!this.inGame) continue;
      if (e.type === 'keydown') this.gameKey(e);
      else if (e.type === 'wheel' && this.player && !this.player.spectator) {
        const inv = this.player.inventory;
        inv.selected = ((inv.selected + e.delta) % 9 + 9) % 9;
      } else if (e.type === 'mousedown' && e.button === 1) this.interaction.pickBlock();
    }
    // mouse look
    const [dx, dy] = inp.consumeMouseDelta();
    if (this.inGame && !this.screen && this.player && !this.player.dead && inp.captured) {
      const s = this.settings.sensitivity * 0.6 + 0.2;
      const f = s * s * s * 8 * 0.15 * Math.PI / 180;
      const p = this.player;
      if (p.sleeping) return;
      p.yaw -= dx * f;
      p.pitch -= dy * f * (this.settings.invertMouse ? -1 : 1);
      p.pitch = clamp(p.pitch, -Math.PI / 2, Math.PI / 2);
    }
  }

  globalKey(e) {
    const b = this.input.bindings;
    if (e.code === b.debug) this.showDebug = !this.showDebug;
    if (e.code === b.fullscreen) this.setFullscreen(!document.fullscreenElement);
  }

  gameKey(e) {
    const b = this.input.bindings, p = this.player;
    if (!p) return;
    if (e.code === 'Escape') { this.setScreen(new PauseScreen(this)); return; }
    if (p.dead) return;
    for (let i = 1; i <= 9; i++) if (e.code === b[`hotbar${i}`]) p.inventory.selected = i - 1;
    if (e.code === b.inventory) { this.openInventory(); return; }
    if (e.code === b.chat) { this.setScreen(new ChatScreen(this, '')); return; }
    if (e.code === b.command) { this.setScreen(new ChatScreen(this, '/')); return; }
    if (e.code === b.drop && !p.spectator) this.interaction.dropHeld(e.ctrl);
    if (e.code === b.swapHands && !p.spectator) this.interaction.swapHands();
    if (e.code === b.perspective) this.thirdPerson = (this.thirdPerson + 1) % 3;
    if (e.code === b.debug) this.showDebug = !this.showDebug;
    if (e.code === b.hideGui) this.hideGui = !this.hideGui;
    if (e.code === b.fullscreen) this.setFullscreen(!document.fullscreenElement);
    if (e.code === b.screenshot) this.takeScreenshot = true;
    if (e.code === b.jump && !e.repeat) {
      if (this.tickCount - this.lastJumpTap < 7 && p.abilities.mayfly && !p.spectator) {
        p.abilities.flying = !p.abilities.flying;
        this.lastJumpTap = -100;
      } else this.lastJumpTap = this.tickCount;
    }
    if (e.code === b.forward && !e.repeat) {
      if (this.tickCount - this.lastForwardTap < 7) this.sprintTap = true;
      this.lastForwardTap = this.tickCount;
    }
    if (e.code === b.sneak && this.settings.toggleSneak) this.sneakToggled = !this.sneakToggled;
    if (e.code === b.sprint && this.settings.toggleSprint) this.sprintToggled = !this.sprintToggled;
  }

  openInventory() {
    const p = this.player;
    if (p.spectator) return;
    this.setScreen(p.creative ? new CreativeScreen(this) : new InventoryScreen(this));
  }

  submitChat(text) {
    this.chatHistory.push(text);
    if (text.startsWith('/')) this.commands.run(text);
    else this.hud.addChat(`<Player> ${text}`);
  }

  // ---------- game tick (20 TPS) ----------
  tick() {
    this.tickCount++;
    const w = this.world, p = this.player;
    if (!w) return; // switching dimensions
    const inp = this.input;
    const b = inp.bindings;
    const active = !this.screen || (this.screen && !this.screen.pausesGame && this.screen instanceof SleepScreen === false && false);
    const canMove = !this.screen && !p.dead && !p.sleeping;
    const key = (a) => canMove && inp.isDown(a);
    const f = (key('forward') ? 1 : 0) - (key('back') ? 1 : 0);
    const s = (key('right') ? 1 : 0) - (key('left') ? 1 : 0);
    p.input.forward = f; p.input.strafe = s;
    p.input.jump = key('jump');
    p.input.sneak = this.settings.toggleSneak ? (canMove && this.sneakToggled) : key('sneak');
    p.input.sprint = (this.settings.toggleSprint ? this.sprintToggled : key('sprint')) || (this.sprintTap && key('forward'));
    if (!key('forward')) this.sprintTap = false;
    void active;
    // interaction (mining/placing) runs before entity ticks like vanilla
    this.interaction.tick(inp, !!this.screen || !inp.captured);
    this.updateHand();
    // world
    w.tickTime();
    w.tickScheduled();
    w.randomTicks(p.x, p.z, Math.min(8, this.settings.renderDistance));
    this.tickBlockEntities();
    this.tickSpawners();
    this.tickEnchantBooks();
    this.entities.tick();
    this.fx.tick();
    if (this.settings.particles !== 'minimal') this.fx.animateTick(p.x, p.y, p.z);
    this.hud.tick();
    this.tickSleep();
    this.tickAmbient();
    if (this.world.dimension === 'overworld') this.tickWeather(); else this.tickNetherAmbience();
    if (this.world) this.checkPortal();
    // eye height smoothing & fov
    this.oEyeHeight = this.eyeHeight;
    this.eyeHeight += (p.eyeHeight - this.eyeHeight) * 0.5;
    this.oFovMod = this.fovMod;
    let fm = 1;
    if (p.abilities.flying) fm *= 1.1;
    const speedRatio = p.effectiveSpeed() / 0.1;
    fm *= (speedRatio + 1) / 2;
    if (p.isUsingItem && p.useItem.item?.use === 'bow') { let t = p.useTicks / 20; t = t > 1 ? 1 : t * t; fm *= 1 - t * 0.15; }
    fm = 1 + (fm - 1) * this.settings.fovEffects;
    this.fovMod += (fm - this.fovMod) * 0.5;
    // stats
    this.stats.playTicks = (this.stats.playTicks ?? 0) + 1;
    if (p.onGround) this.stats.walked = (this.stats.walked ?? 0) + Math.hypot(p.x - p.px, p.z - p.pz);
    // autosave every minute
    if (this.tickCount - this.lastSave > 1200) { this.lastSave = this.tickCount; this.saveGame(); }
    if (p.y < MIN_Y - 64 && p.dead === false) p.hurt({ type: 'void' }, 4);
  }

  updateHand() {
    const h = this.handState, p = this.player;
    h.oMain = h.main; h.oOff = h.off;
    const main = p.inventory.held, off = p.inventory.offhand;
    const same = (a, b) => a === b || (a && b && a.id === b.id && a.count === b.count && a.damage === b.damage);
    const f = p.attackStrength(1);
    const reqMain = same(h.lastMain, main);
    h.mainHeight += clamp((reqMain ? f * f * f : 0) - h.mainHeight, -0.4, 0.4);
    const reqOff = same(h.lastOff, off);
    h.offHeight += clamp((reqOff ? 1 : 0) - h.offHeight, -0.4, 0.4);
    if (h.mainHeight < 0.1) h.lastMain = main;
    if (h.offHeight < 0.1) h.lastOff = off;
    h.main = 1 - h.mainHeight; h.off = 1 - h.offHeight;
  }

  tickWeather() {
    const w = this.world, p = this.player;
    // rain loop volume follows how exposed the player is
    const exposed = w.rain > 0.2 && w.canSeeSky(Math.floor(p.x), Math.floor(p.y + p.eyeHeight), Math.floor(p.z)) ? 1 : 0.25;
    const biome = w.getBiomeDef(Math.floor(p.x), Math.floor(p.z));
    const raining = w.rain > 0.2 && biome.downfall > 0 && !biome.snowy;
    if (raining && !this.rainSound) this.rainSound = this.sound.play('weather.rain', { volume: 0.4, loop: true });
    if ((!raining || !this.inGame) && this.rainSound) { this.rainSound.stop?.(); this.rainSound = null; }
    if (this.rainSound?.setVolume) this.rainSound.setVolume(0.4 * w.rain * exposed);
    // splash particles on exposed ground
    if (raining && this.settings.particles !== 'minimal') {
      const n = Math.floor(100 * w.rain * w.rain * (this.settings.particles === 'all' ? 1 : 0.5) / 10);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(p.x) + Math.floor(Math.random() * 21) - 10, z = Math.floor(p.z) + Math.floor(Math.random() * 21) - 10;
        const y = w.getHeight(x, z);
        if (Math.abs(y - p.y) > 12) continue;
        const def = BlockById[w.getBlockId(x, y, z)];
        if (def.liquid === 'lava' || def.name === 'fire') this.fx.smokeAt(x + Math.random(), y + 1.1, z + Math.random());
        else this.fx.sprite('splash_0', x + Math.random(), y + 1.02, z + Math.random(), 0, 0.05, 0, { life: 6, size: 0.05, gravity: 0.04, r: 0.5, g: 0.6, b: 1, frames: ['splash_0', 'splash_1', 'splash_2', 'splash_3'] });
      }
    }
    // thunder & lightning
    if (w.thunder > 0.9 && Math.random() < 1 / 1200) {
      this.lightningFlash = 3;
      const x = Math.floor(p.x) + Math.floor(Math.random() * 96) - 48, z = Math.floor(p.z) + Math.floor(Math.random() * 96) - 48;
      const y = w.getHeight(x, z) + 1;
      const d = Math.hypot(x - p.x, z - p.z);
      this.sound.play('ambient.weather.thunder', { volume: 1, pitch: 0.8 + Math.random() * 0.2 });
      if (d < 48 && w.gamerules.doFireTick && w.difficulty >= 2 && w.getBlock(x, y, z) === 0 && BlockById[w.getBlockId(x, y - 1, z)].solid) {
        w.setBlock(x, y, z, packBlock(B.fire, 0)); w.scheduleTick(x, y, z, 30);
      }
      for (const e of this.entities.list) if (e.isLiving && Math.hypot(e.x - x, e.z - z) < 3 && Math.abs(e.y - y) < 6) { e.hurt({ type: 'lightning' }, 5); e.setOnFire?.(8); if (e.type === 'creeper') e.powered = true; }
    }
    if (this.lightningFlash > 0) this.lightningFlash--;
  }

  tickNetherAmbience() {
    const p = this.player, w = this.world;
    const biome = w.getBiomeDef(Math.floor(p.x), Math.floor(p.z));
    const name = `ambient.nether.${biome.name}`;
    if (this.ambientLoopName !== name) {
      this.stopAmbientLoop();
      this.ambientLoopName = name;
      this.ambientLoop = this.sound.play(name, { volume: 0.5, loop: true });
    }
    if (Math.random() < 1 / 400) this.sound.play('ambient.nether.additions', { volume: 0.6, pitch: 0.8 + Math.random() * 0.4 });
  }
  stopAmbientLoop() {
    if (this.ambientLoop) { this.ambientLoop.stop?.(); this.ambientLoop = null; }
    this.ambientLoopName = null;
  }

  tickAmbient() {
    const p = this.player;
    // cave ambience is handled by the sound manager's update(); lava & water ambience nearby
    if (this.tickCount % 40 === 0) {
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const def = BlockById[this.world.getBlockId(x + Math.floor(Math.random() * 16 - 8), y + Math.floor(Math.random() * 8 - 4), z + Math.floor(Math.random() * 16 - 8))];
      if (def.liquid === 'lava' && Math.random() < 0.3) this.sound.play('liquid.lava', { x: p.x, y: p.y, z: p.z, volume: 0.3 });
    }
  }

  // ---------- rendering ----------
  renderFrame(partial, dt) {
    const g = this.gui;
    const r = this.renderer;
    // title panorama
    if (!this.world && this.panorama) {
      const pan = this.panorama;
      pan.world.update(pan.x, pan.z, 6, 4);
      pan.gen.pump(6);
      r.updateMeshes(pan.world, [pan.x, pan.y, pan.z], 6, 6);
      pan.yaw += dt * 0.00004;
      let meshed = 0;
      for (const c of pan.world.chunks.values()) if (c.meshes.some((m) => m)) meshed++;
      this.panoramaReady = meshed > 20;
      const cam = { pos: [pan.x, pan.y, pan.z], yaw: pan.yaw, pitch: -0.15, fov: 85 };
      const saved = r.extraRenderers; r.extraRenderers = [];
      r.render(pan.world, cam, { renderDistance: 6, timeSec: performance.now() / 1000, worldTime: pan.world.time + performance.now() / 50, partial: 0, lookDir: [0, 0, -1], gamma: 0.5, cloudsOff: false });
      r.extraRenderers = saved;
    } else if (!this.world) {
      const gl = r.gl;
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (this.world) {
      const p = this.player, w = this.world;
      if (this.loading) this.updateLoading();
      const rd = this.settings.renderDistance;
      w.update(p.x, p.z, rd, this.loading ? 12 : 5);
      this.genPool.pump(this.loading ? 12 : 5);
      this.interaction.updateTarget();
      const cam = this.computeCamera(partial);
      r.updateMeshes(w, cam.pos, this.loading ? 20 : 5, rd);
      const eyeB = w.getBlock(Math.floor(cam.eyeWorld[0]), Math.floor(cam.eyeWorld[1]), Math.floor(cam.eyeWorld[2]));
      const edef = BlockById[eyeB & ID_MASK];
      let eyeFluid = null;
      if (edef.liquid || edef.waterlogged) {
        const top = Math.floor(cam.eyeWorld[1]) + ((eyeB >>> 12) >= 8 || edef.waterlogged ? 1 : (8 - (eyeB >>> 12)) / 9);
        if (cam.eyeWorld[1] < top) eyeFluid = edef.liquid === 'lava' ? 'lava' : 'water';
      }
      const lookDir = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
      const eyeSky = w.getSkyLight(Math.floor(cam.eyeWorld[0]), Math.floor(cam.eyeWorld[1]), Math.floor(cam.eyeWorld[2]));
      r.render(w, cam, {
        renderDistance: rd, timeSec: performance.now() / 1000, worldTime: w.time + partial, partial, lookDir, gamma: this.settings.gamma,
        eyeFluid, eyeSkyLight: Math.max(eyeSky, p.y > 50 ? 15 : eyeSky), lightningFlash: this.lightningFlash > 0, nightVision: p.hasEffect('night_vision') ? 1 : 0, blindness: p.hasEffect('blindness'),
        selection: this.hideGui || p.spectator ? null : this.interaction.target, breakStage: this.interaction.breakStage(), cloudsOff: this.settings.clouds === 'off',
      });
      if (this.playerPreview) this.renderPlayerPreview();
      // sound listener
      this.sound.setListener(cam.eyeWorld[0], cam.eyeWorld[1], cam.eyeWorld[2], p.yaw, p.pitch);
      this.sound.update(dt / 1000, { underground: eyeSky < 5 && p.y < 60, time: w.dayTime });
    } else this.sound.update(dt / 1000, {});
    // UI
    g.begin();
    if (this.world && this.inGame) this.hud.render(g, partial);
    if (this.screen) {
      const mx = this.input.mx / g.scale, my = this.input.my / g.scale;
      this.screen.render(g, mx, my, partial);
    }
    if (this.takeScreenshot) { this.takeScreenshot = false; this.saveScreenshot(); }
  }

  computeCamera(t) {
    const p = this.player;
    const pos = p.lerpPos(t);
    const eh = this.oEyeHeight + (this.eyeHeight - this.oEyeHeight) * t;
    let eye = [pos[0], pos[1] + eh, pos[2]];
    if (p.sleeping) eye = [pos[0], pos[1] + 0.3, pos[2]];
    let yaw = p.pyaw + wrapDiff(p.yaw - p.pyaw) * t;
    let pitch = p.ppitch + (p.pitch - p.ppitch) * t;
    if (Math.abs(p.yaw - p.pyaw) > 0.00001) yaw = p.yaw; // mouse look is applied per frame
    pitch = p.pitch; yaw = p.yaw;
    const cam = { pos: eye, eyeWorld: eye, yaw, pitch, roll: 0, fov: this.settings.fov };
    // fov modifiers
    let fov = this.settings.fov * (this.oFovMod + (this.fovMod - this.oFovMod) * t);
    if (p.eyeInWater) fov *= 1 - (1 - 0.85714287) * this.settings.fovEffects;
    cam.fov = fov;
    // hurt tilt
    if (this.settings.damageTilt) {
      let roll = 0;
      if (p.dead) roll += (40 - 8000 / (Math.min(p.deathTime + t, 20) + 200)) * Math.PI / 180;
      if (p.hurtTime > 0) {
        let f = (p.hurtTime - t) / p.hurtDuration;
        f = Math.sin(f * f * f * f * Math.PI);
        roll += -f * 14 * Math.PI / 180 * Math.cos(p.hurtDir);
      }
      cam.roll = roll * this.settings.screenEffects;
    }
    // view bobbing
    if (this.settings.viewBobbing && !this.thirdPerson && !p.abilities.flying) {
      const wd = -(p.walkDist + (p.walkDist - p.walkDistO) * t);
      const bob = p.oBob + (p.bob - p.oBob) * t;
      cam.bob = {
        x: Math.sin(wd * Math.PI) * bob * 0.5,
        y: -Math.abs(Math.cos(wd * Math.PI) * bob),
        rz: Math.sin(wd * Math.PI) * bob * 3 * Math.PI / 180,
        rx: Math.abs(Math.cos(wd * Math.PI - 0.2) * bob) * 5 * Math.PI / 180,
      };
    }
    // third person camera
    if (this.thirdPerson) {
      const front = this.thirdPerson === 2;
      const cy = front ? yaw + Math.PI : yaw, cpitch = front ? -pitch : pitch;
      const dir = [Math.sin(cy) * Math.cos(cpitch), -Math.sin(cpitch), Math.cos(cy) * Math.cos(cpitch)];
      let dist = 4;
      // pull camera in if blocked
      for (let d = 0.2; d <= 4; d += 0.1) {
        const x = eye[0] + dir[0] * d, y = eye[1] + dir[1] * d, z = eye[2] + dir[2] * d;
        if (BlockById[this.world.getBlockId(Math.floor(x), Math.floor(y), Math.floor(z))].opaque) { dist = Math.max(0.3, d - 0.2); break; }
      }
      cam.pos = [eye[0] + dir[0] * dist, eye[1] + dir[1] * dist, eye[2] + dir[2] * dist];
      cam.yaw = cy; cam.pitch = cpitch;
      cam.thirdPerson = true;
      cam.tpOffset = [0, 0, 0];
    }
    return cam;
  }

  renderPlayerPreview() {
    const pv = this.playerPreview;
    const r = this.renderer, gl = r.gl, p = this.player;
    const H = r.height;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(pv.x), Math.floor(H - pv.y - pv.h), Math.ceil(pv.w), Math.ceil(pv.h));
    gl.viewport(Math.floor(pv.x), Math.floor(H - pv.y - pv.h), Math.ceil(pv.w), Math.ceil(pv.h));
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const obj = this.objects;
    obj.blockBatch.reset(); obj.itemBatch.reset(); obj.entityBatch.reset(); obj.particleBatch.reset();
    // entity looks towards the mouse like vanilla's InventoryScreen.renderEntityInInventory
    const cx = pv.x + pv.w / 2, cy = pv.y + pv.h * 0.3;
    const lookX = Math.atan((cx - pv.mx) / 40 / (r.width / 800)), lookY = Math.atan((cy - pv.my) / 40 / (r.width / 800));
    const saved = { yaw: p.yaw, pyaw: p.pyaw, bodyYaw: p.bodyYaw, pbodyYaw: p.pbodyYaw, headYaw: p.headYaw, pheadYaw: p.pheadYaw, pitch: p.pitch, ppitch: p.ppitch, x: p.x, y: p.y, z: p.z, px: p.px, py: p.py, pz: p.pz, hurtTime: p.hurtTime, limbSwingAmount: p.limbSwingAmount, prevLimbSwingAmount: p.prevLimbSwingAmount };
    p.x = p.px = 0; p.y = p.py = 0; p.z = p.pz = 0;
    p.bodyYaw = p.pbodyYaw = Math.PI + lookX * 0.35;
    p.yaw = p.pyaw = p.headYaw = p.pheadYaw = Math.PI + lookX;
    p.pitch = p.ppitch = lookY * 0.5 * 2;
    p.limbSwingAmount = p.prevLimbSwingAmount = 0;
    const light = [1, 1];
    obj.drawPlayer(p, 1, this.world, [0, 0, 0], light);
    Object.assign(p, saved);
    const aspect = pv.w / pv.h;
    const proj = mat4.ortho(mat4.create(), -1.05 * aspect, 1.05 * aspect, -0.2, 1.9 + 0.1, -10, 10);
    const view = mat4.identity(mat4.create());
    const vp = mat4.multiply(mat4.create(), proj, view);
    obj.flush({ viewProj: vp, env: { fogColor: [0, 0, 0], fogStart: 1e5, fogEnd: 2e5 }, lightmap: r.lightmap }, 0.1);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, r.width, r.height);
  }

  saveScreenshot() {
    try {
      const c = document.createElement('canvas');
      c.width = this.canvas.width; c.height = this.canvas.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(this.canvas, 0, 0);
      ctx.drawImage(this.uiCanvas, 0, 0);
      const a = document.createElement('a');
      a.download = `blockcraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.href = c.toDataURL('image/png');
      a.click();
      this.hud.addChat(`Saved screenshot as ${a.download}`);
    } catch (e) { this.hud.addChat('§cCould not save screenshot'); }
  }

  // ---------- world interaction services used by entities / logic ----------
  spawnEntity(e) { this.entities.add(e); return e; }

  spawnMob(type, x, y, z, opts = {}) {
    const C = MOB_TYPES[type];
    if (!C) return null;
    const m = new C(this.world);
    m.setPos(x, y, z);
    m.yaw = Math.random() * Math.PI * 2; m.bodyYaw = m.yaw; m.headYaw = m.yaw;
    if (opts.baby && m.setBaby) m.setBaby(true);
    this.entities.add(m);
    return m;
  }

  spawnItem(x, y, z, stack, opts = {}) {
    if (!stack || stack.empty) return null;
    const e = new ItemEntity(this.world, stack);
    e.setPos(x, y - 0.125, z);
    if (opts.velocity) [e.vx, e.vy, e.vz] = opts.velocity;
    else { e.vx = Math.random() * 0.2 - 0.1; e.vy = 0.2; e.vz = Math.random() * 0.2 - 0.1; }
    if (opts.scatter) { e.x += (Math.random() - 0.5) * 0.5; e.z += (Math.random() - 0.5) * 0.5; }
    e.pickupDelay = opts.pickupDelay ?? 10;
    this.entities.add(e);
    return e;
  }

  // Block.popResource style: items pop out of the broken block
  dropBlockItems(x, y, z, v, tool, player = null, explosion = false) {
    const def = BlockById[v & ID_MASK];
    const held = tool;
    const canHarvest = this.interaction.canHarvest(def, held) || !def.needsTool;
    if (def.needsTool && !canHarvest && !explosion) return;
    let drops;
    const ctx = {
      block: def, meta: v >>> 12, rand: Math.random, tool: held?.item?.tool?.type ?? (held?.item?.name === 'shears' ? 'shears' : null),
      silkTouch: !!held && held.enchantLevel('silk_touch') > 0, fortune: held ? held.enchantLevel('fortune') : 0, canHarvest,
    };
    if (ctx.silkTouch && def.item && def.drops !== undefined && def.drops !== null && typeof def.drops !== 'string' && !def.crop) drops = [{ item: def.name, count: 1 }];
    else if (def.drops === undefined) drops = def.item ? [{ item: def.name, count: 1 }] : [];
    else if (def.drops === null) drops = ctx.silkTouch && def.item ? [{ item: def.name, count: 1 }] : [];
    else if (typeof def.drops === 'string') drops = [{ item: def.drops, count: 1 }];
    else drops = def.drops(ctx);
    if (def.shape === 'slab' && (v >>> 12) === 2) drops = [{ item: def.name, count: 2 }];
    if (def.name === 'snow' && ctx.tool !== 'shovel') drops = [];
    for (const d of drops) {
      const it = Items[d.item];
      if (!it || d.count <= 0) continue;
      const e = this.spawnItem(x + 0.5 + (Math.random() - 0.5) * 0.5, y + 0.5 + (Math.random() - 0.5) * 0.5, z + 0.5 + (Math.random() - 0.5) * 0.5, new ItemStack(it.id, d.count));
      if (e) { e.vx = Math.random() * 0.2 - 0.1; e.vy = 0.2; e.vz = Math.random() * 0.2 - 0.1; }
    }
    if (player) this.stats.mined = (this.stats.mined ?? 0) + 1;
  }

  dropFromPlayer(stack, silent = false) {
    const p = this.player;
    if (!stack || stack.empty) return;
    const e = new ItemEntity(this.world, stack);
    e.setPos(p.x, p.y + p.eyeHeight - 0.3, p.z);
    const f = 0.3;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), sp = Math.sin(p.pitch), cp = Math.cos(p.pitch);
    const ang = Math.random() * Math.PI * 2, r = 0.02 * Math.random();
    e.vx = -sy * cp * f + Math.cos(ang) * r;
    e.vy = sp * f + 0.1 + (Math.random() - Math.random()) * 0.1;
    e.vz = -cy * cp * f + Math.sin(ang) * r;
    e.pickupDelay = 40;
    this.entities.add(e);
    void silent;
  }

  spawnXp(x, y, z, amount) {
    while (amount > 0) {
      const v = amount >= 2477 ? 2477 : amount >= 1237 ? 1237 : amount >= 617 ? 617 : amount >= 307 ? 307 : amount >= 149 ? 149 : amount >= 73 ? 73 : amount >= 37 ? 37 : amount >= 17 ? 17 : amount >= 7 ? 7 : amount >= 3 ? 3 : 1;
      amount -= v;
      const o = new XpOrb(this.world, v);
      o.setPos(x, y, z);
      o.vx = (Math.random() * 0.2 - 0.1) * 2; o.vy = Math.random() * 0.2 * 2; o.vz = (Math.random() * 0.2 - 0.1) * 2;
      this.entities.add(o);
    }
  }

  spawnFallingBlock(x, y, z, v) {
    const e = new FallingBlock(this.world, v);
    e.setPos(x + 0.5, y, z + 0.5);
    this.entities.add(e);
  }

  primeTnt(x, y, z, owner, fuse = 80) {
    const e = new PrimedTnt(this.world, fuse, owner);
    e.setPos(x + 0.5, y, z + 0.5);
    this.entities.add(e);
    this.sound.play('entity.tnt.primed', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  explode(x, y, z, power, opts) { explode(this, x, y, z, power, opts); }

  shootArrow(p, power, bow) {
    const a = new Arrow(this.world, p);
    a.setPos(p.x, p.y + p.eyeHeight - 0.1, p.z);
    const cp = Math.cos(p.pitch);
    a.shoot(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp, power * 3, 1);
    a.vx += p.vx; a.vz += p.vz; if (!p.onGround) a.vy += p.vy;
    if (power >= 1) a.crit = true;
    const pw = bow.enchantLevel('power');
    if (pw > 0) a.baseDamage += pw * 0.5 + 0.5;
    a.knockbackLevel = bow.enchantLevel('punch');
    if (bow.enchantLevel('flame') > 0) a.fireTicks = 2000;
    const infinite = p.creative || bow.enchantLevel('infinity') > 0;
    if (infinite) a.pickup = 'creative';
    this.entities.add(a);
    this.sound.play('random.bow', { x: p.x, y: p.y, z: p.z, pitch: 1 / (Math.random() * 0.4 + 1.2) + power * 0.5 });
    if (!p.creative) {
      if (!infinite) {
        const off = p.inventory.offhand;
        if (off && off.id === Items.arrow.id) { off.count--; if (off.count <= 0) p.inventory.slots[40] = null; }
        else p.inventory.removeItem(Items.arrow.id, 1);
      }
      if (bow.hurt(1)) { p.inventory.held = null; this.sound.play('random.break', { x: p.x, y: p.y, z: p.z }); }
      p.inventory.changed();
    }
  }

  throwProjectile(p, itemName) {
    const e = new ThrownItem(this.world, itemName, p);
    e.setPos(p.x, p.y + p.eyeHeight - 0.1, p.z);
    const cp = Math.cos(p.pitch);
    const up = itemName === 'experience_bottle' ? -20 * Math.PI / 180 : 0;
    e.shoot(-Math.sin(p.yaw) * cp, Math.sin(p.pitch - up), -Math.cos(p.yaw) * cp, itemName === 'experience_bottle' ? 0.7 : 1.5, 1);
    e.vx += p.vx; e.vz += p.vz;
    this.entities.add(e);
    this.sound.play('random.bow', { x: p.x, y: p.y, z: p.z, volume: 0.5, pitch: 0.4 / (Math.random() * 0.4 + 0.8) });
  }

  growTree(x, y, z, wood) {
    const w = this.world;
    const old = w.getBlock(x, y, z);
    const kind = wood === 'oak' ? (Math.random() < 0.1 ? 'fancy_oak' : 'oak') : wood === 'jungle' ? 'jungle' : wood;
    w.setBlock(x, y, z, 0, SB_ALL & ~4);
    const access = { getBlock: (a, b, c) => w.getBlock(a, b, c), setBlock: (a, b, c, v) => w.setBlock(a, b, c, v) };
    let ok = false;
    try { ok = this.genPool.placeFeature(access, { type: 'tree', kind, x, y, z, seed: (Math.random() * 2 ** 31) | 0 }); } catch (e) { ok = false; }
    if (ok === false) w.setBlock(x, y, z, old, SB_ALL & ~4);
    return ok !== false;
  }

  boneMeal(x, y, z) {
    const w = this.world;
    const v = w.getBlock(x, y, z);
    const def = BlockById[v & ID_MASK];
    const green = () => { for (let i = 0; i < 12; i++) this.fx.sprite('generic_0', x + Math.random(), y + Math.random() * 1.2, z + Math.random(), 0, 0.02, 0, { life: 20, size: 0.06, r: 0.3, g: 0.9, b: 0.3 }); };
    if (def.crop) {
      const age = v >>> 12;
      if (age >= 7) return false;
      w.setBlock(x, y, z, packBlock(def.id, Math.min(7, age + 2 + Math.floor(Math.random() * 4))));
      green(); return true;
    }
    if (def.sapling) {
      if (Math.random() < 0.45) { if ((v >>> 12) === 0) w.setBlock(x, y, z, packBlock(def.id, 1)); else this.growTree(x, y, z, def.sapling); }
      green(); return true;
    }
    if (def.berry) { const age = v >>> 12; if (age >= 3) return false; w.setBlock(x, y, z, packBlock(def.id, age + 1)); green(); return true; }
    if (def.id === B.grass_block && w.getBlock(x, y + 1, z) === 0) {
      for (let i = 0; i < 64; i++) {
        let tx = x, ty = y + 1, tz = z;
        for (let j = 0; j < i / 16; j++) { tx += Math.floor(Math.random() * 3) - 1; ty += Math.floor((Math.random() * 3 - 1) * Math.random() * 3 / 2); tz += Math.floor(Math.random() * 3) - 1; }
        if (w.getBlockId(tx, ty - 1, tz) !== B.grass_block || w.getBlock(tx, ty, tz) !== 0) continue;
        const r = Math.random();
        w.setBlock(tx, ty, tz, r < 0.8 ? B.grass : r < 0.9 ? B.dandelion : B.poppy);
      }
      green(); return true;
    }
    return false;
  }

  // ---------- block entities ----------
  createBlockEntity(x, y, z, type) {
    let be;
    if (type === 'chest') be = { type: 'chest', inventory: new Inventory(27) };
    else if (type === 'furnace') be = { type: 'furnace', inventory: new Inventory(3), burnTime: 0, burnDuration: 0, cookTime: 0, cookDuration: 200, xp: 0 };
    else return null;
    this.world.setBlockEntity(x, y, z, be);
    return be;
  }

  interactBlock(x, y, z, v, def, player) {
    const w = this.world;
    switch (def.interact) {
      case 'crafting_table': this.setScreen(new CraftingScreen(this)); return true;
      case 'enchanting_table': this.setScreen(new EnchantmentScreen(this, [x, y, z])); return true;
      case 'anvil': this.setScreen(new AnvilScreen(this, [x, y, z])); return true;
      case 'chest': {
        if (BlockById[w.getBlockId(x, y + 1, z)].opaque) return true;
        let be = w.getBlockEntity(x, y, z);
        if (!be) { be = this.createBlockEntity(x, y, z, 'chest'); this.fillLoot(be, x, y, z); }
        this.sound.play('random.chest_open', { x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.5, pitch: Math.random() * 0.1 + 0.9 });
        const c = w.getChunk(x >> 4, z >> 4); if (c) c.modified = true;
        this.setScreen(new ChestScreen(this, be));
        this.openChestPos = [x, y, z];
        return true;
      }
      case 'furnace': {
        let be = w.getBlockEntity(x, y, z);
        if (!be) be = this.createBlockEntity(x, y, z, 'furnace');
        const c = w.getChunk(x >> 4, z >> 4); if (c) c.modified = true;
        this.setScreen(new FurnaceScreen(this, be));
        return true;
      }
      case 'door': {
        const meta = v >>> 12;
        const upper = (meta & 8) !== 0;
        const ly = upper ? y - 1 : y;
        const lower = w.getBlock(x, ly, z);
        const nm = (lower >>> 12) ^ 4;
        w.setBlock(x, ly, z, packBlock(def.id, nm), SB_ALL & ~4);
        w.markDirtyAt(x, ly + 1, z);
        this.sound.play((nm & 4) ? 'random.door_open' : 'random.door_close', { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: Math.random() * 0.1 + 0.9 });
        return true;
      }
      case 'trapdoor': {
        w.setBlock(x, y, z, packBlock(def.id, (v >>> 12) ^ 4));
        this.sound.play(((v >>> 12) & 4) ? 'random.door_close' : 'random.door_open', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        return true;
      }
      case 'bed': return this.trySleep(x, y, z, v);
      case 'tnt': {
        const held = player.inventory.held;
        if (held?.item?.use === 'ignite') {
          w.setBlock(x, y, z, 0);
          this.primeTnt(x, y, z, player);
          this.interaction.damageHeld('main', 1);
          return true;
        }
        return false;
      }
      default: return false;
    }
  }

  onChestClosed() {
    const pos = this.openChestPos;
    if (pos) this.sound.play('random.chest_close', { x: pos[0] + 0.5, y: pos[1] + 0.5, z: pos[2] + 0.5, volume: 0.5, pitch: Math.random() * 0.1 + 0.9 });
  }

  fillLoot(be, x, y, z) {
    // chests generated in dungeons get loot the first time they are opened
    const nearSpawner = [...this.spawners.keys()].some((k) => { const [a, b, c] = k.split(',').map(Number); return Math.abs(a - x) < 8 && Math.abs(b - y) < 4 && Math.abs(c - z) < 8; });
    if (!nearSpawner) { if (this.inVillageHouse(x, y, z)) this.rollLoot(be, VILLAGE_LOOT, 3, 7); return; }
    const table = [['bread', 1, 1, 20], ['wheat', 1, 4, 20], ['iron_ingot', 1, 4, 10], ['gold_ingot', 1, 4, 5], ['redstone', 1, 4, 15], ['coal', 1, 4, 15],
      ['string', 1, 8, 10], ['gunpowder', 1, 8, 10], ['bone', 1, 8, 10], ['rotten_flesh', 1, 8, 10], ['bucket', 1, 1, 10], ['saddle', 1, 1, 20],
      ['name_tag', 1, 1, 20], ['golden_apple', 1, 1, 15], ['enchanted_golden_apple', 1, 1, 2], ['iron_horse_armor', 1, 1, 0], ['diamond', 1, 2, 3], ['apple', 1, 3, 10]];
    const total = table.reduce((s, t) => s + t[3], 0);
    const rolls = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < rolls; i++) {
      let r = Math.random() * total;
      for (const [name, a, b, wgt] of table) {
        if ((r -= wgt) < 0) {
          const it = Items[name];
          if (it) be.inventory.slots[Math.floor(Math.random() * 27)] = new ItemStack(it.id, a + Math.floor(Math.random() * (b - a + 1)));
          break;
        }
      }
    }
  }

  // generated village houses are recorded as chunk features; chests inside them get village loot
  inVillageHouse(x, y, z) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.world.getChunk((x >> 4) + dx, (z >> 4) + dz);
      for (const f of c?.features ?? []) {
        if (f.type === 'v_house' && x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && y > f.y && y <= f.y + 4) return true;
      }
    }
    return false;
  }

  rollLoot(be, table, minRolls, maxRolls) {
    const total = table.reduce((s, t) => s + t[3], 0);
    const rolls = minRolls + Math.floor(Math.random() * (maxRolls - minRolls + 1));
    for (let i = 0; i < rolls; i++) {
      let r = Math.random() * total;
      for (const [name, a, b, wgt] of table) {
        if ((r -= wgt) >= 0) continue;
        const it = Items[name];
        if (!it) break;
        let slot = Math.floor(Math.random() * 27);
        for (let k = 0; k < 27 && be.inventory.slots[slot]; k++) slot = (slot + 1) % 27;
        be.inventory.slots[slot] = new ItemStack(it.id, Math.min(it.stack ?? 64, a + Math.floor(Math.random() * (b - a + 1))));
        break;
      }
    }
  }

  tickBlockEntities() {
    const w = this.world;
    for (const c of w.chunks.values()) {
      if (c.state < CS_LIT || !c.blockEntities.size) continue;
      for (const be of c.blockEntities.values()) {
        if (be.type === 'furnace') this.tickFurnace(be, c);
      }
    }
  }

  tickFurnace(be, c) {
    const inv = be.inventory;
    const input = inv.slots[0], fuel = inv.slots[1], out = inv.slots[2];
    const wasLit = be.burnTime > 0;
    if (be.burnTime > 0) be.burnTime--;
    const recipe = input ? SMELTING.get(input.id) : null;
    const canSmelt = !!recipe && (!out || (out.id === recipe.result && out.count < out.maxStack));
    if (be.burnTime === 0 && canSmelt) {
      const f = fuelOf(fuel);
      if (f > 0) {
        be.burnTime = be.burnDuration = f;
        if (fuel.item.name === 'lava_bucket') inv.slots[1] = ItemStack.of('bucket');
        else { fuel.count--; if (fuel.count <= 0) inv.slots[1] = null; }
      }
    }
    if (be.burnTime > 0 && canSmelt) {
      be.cookTime++;
      if (be.cookTime >= be.cookDuration) {
        be.cookTime = 0;
        if (out) out.count++; else inv.slots[2] = new ItemStack(recipe.result, 1);
        input.count--; if (input.count <= 0) inv.slots[0] = null;
        be.xp = (be.xp ?? 0) + recipe.xp;
      }
    } else if (!canSmelt) be.cookTime = 0;
    else if (be.burnTime === 0 && be.cookTime > 0) be.cookTime = Math.max(0, be.cookTime - 2);
    const lit = be.burnTime > 0;
    if (wasLit !== lit) {
      const w = this.world;
      const v = w.getBlock(be.x, be.y, be.z);
      const keepBe = be;
      w.setBlock(be.x, be.y, be.z, packBlock(lit ? B.lit_furnace : B.furnace, v >>> 12), SB_ALL & ~4);
      w.setBlockEntity(be.x, be.y, be.z, keepBe);
    }
    if (wasLit || be.cookTime) c.modified = true;
  }

  // ---------- spawners ----------
  scanSpawners(c) {
    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = c.sections[si];
      if (!s) continue;
      for (let i = 0; i < 4096; i++) {
        const id = s[i] & ID_MASK;
        if (id !== B.spawner && id !== B.enchanting_table) continue;
        const x = (c.cx << 4) + (i & 15), y = MIN_Y + si * 16 + (i >> 8), z = (c.cz << 4) + ((i >> 4) & 15);
        if (id === B.enchanting_table) { this.enchTables.set(`${x},${y},${z}`, { x, y, z }); continue; }
        const h = hash4(x, y, z, this.world.seed);
        const type = this.world.dimension === 'nether' ? 'blaze' : ['zombie', 'zombie', 'skeleton', 'spider'][h & 3];
        this.spawners.set(`${x},${y},${z}`, { x, y, z, type, delay: 20 });
      }
    }
  }
  // EnchantmentTableBlockEntity.bookAnimationTick
  tickEnchantBooks() {
    const p = this.player;
    for (const b of this.enchTables.values()) {
      const cx = b.x + 0.5, cy = b.y + 0.5, cz = b.z + 0.5;
      if (Math.abs(cx - p.x) > 32 || Math.abs(cz - p.z) > 32) continue;
      const a = b.anim ?? (b.anim = { time: 0, open: 0, oOpen: 0, rot: 0, oRot: 0, tRot: 0, flip: 0, oFlip: 0, flipT: 0, flipA: 0 });
      a.oOpen = a.open; a.oRot = a.rot;
      const near = !p.spectator && Math.hypot(p.x - cx, p.y - cy, p.z - cz) < 3;
      if (near) {
        a.tRot = Math.atan2(p.z - cz, p.x - cx);
        a.open += 0.1;
        if (a.open < 0.5 || Math.random() < 1 / 40) {
          const f1 = a.flipT;
          do { a.flipT += Math.floor(Math.random() * 4) - Math.floor(Math.random() * 4); } while (f1 === a.flipT);
        }
      } else { a.tRot += 0.02; a.open -= 0.1; }
      while (a.rot >= Math.PI) a.rot -= Math.PI * 2;
      while (a.rot < -Math.PI) a.rot += Math.PI * 2;
      while (a.tRot >= Math.PI) a.tRot -= Math.PI * 2;
      while (a.tRot < -Math.PI) a.tRot += Math.PI * 2;
      let d = a.tRot - a.rot;
      while (d >= Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.rot += d * 0.4;
      a.open = Math.max(0, Math.min(1, a.open));
      a.time++;
      a.oFlip = a.flip;
      let f = (a.flipT - a.flip) * 0.4;
      f = Math.max(-0.2, Math.min(0.2, f));
      a.flipA += (f - a.flipA) * 0.9;
      a.flip += a.flipA;
      // enchanting glyph particles drifting from nearby bookshelves
      if (near && Math.random() < 0.5) {
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
          if (Math.random() > 1 / 16) continue;
          for (let dy = 0; dy <= 1; dy++) {
            if (this.world.getBlockId(b.x + dx, b.y + dy, b.z + dz) !== B.bookshelf) continue;
            this.fx.enchantGlyph?.(b.x + dx + 0.5, b.y + dy + 1.5, b.z + dz + 0.5, cx, b.y + 2, cz);
          }
        }
      }
    }
  }

  tickSpawners() {
    const p = this.player, w = this.world;
    if (w.difficulty === 0) return;
    for (const sp of this.spawners.values()) {
      if (Math.hypot(sp.x + 0.5 - p.x, sp.y + 0.5 - p.y, sp.z + 0.5 - p.z) > 16) continue;
      if (w.getBlockId(sp.x, sp.y, sp.z) !== B.spawner) continue;
      if (Math.random() < 0.3) this.fx.flame(sp.x + Math.random(), sp.y + Math.random(), sp.z + Math.random());
      if (--sp.delay > 0) continue;
      sp.delay = 200 + Math.floor(Math.random() * 600);
      let near = 0;
      for (const e of this.entities.list) if (e.type === sp.type && Math.abs(e.x - sp.x) < 9 && Math.abs(e.y - sp.y) < 5 && Math.abs(e.z - sp.z) < 9) near++;
      if (near >= 6) continue;
      for (let i = 0; i < 4; i++) {
        const x = sp.x + Math.floor((Math.random() - Math.random()) * 4), y = sp.y + Math.floor(Math.random() * 3) - 1, z = sp.z + Math.floor((Math.random() - Math.random()) * 4);
        if (!this.entities.validSpawn(x, y, z, sp.type === 'spider' ? 1 : 2) || w.getBlockLight(x, y, z) > 11) continue;
        const m = this.spawnMob(sp.type, x + 0.5, y, z + 0.5);
        if (m) { m.persistent = false; this.fx.poof(m); }
      }
    }
  }

  // ---------- sleeping ----------
  trySleep(x, y, z, v) {
    const p = this.player, w = this.world;
    const meta = v >>> 12;
    // find head part
    let hx = x, hz = z;
    if (!(meta & 4)) { const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][meta & 3]; hx += d[0]; hz += d[1]; }
    if (w.dimension !== 'overworld') {
      // beds explode outside the Overworld (intentional game design)
      w.setBlock(x, y, z, 0);
      if (hx !== x || hz !== z) w.setBlock(hx, y, hz, 0);
      else { const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][meta & 3]; w.setBlock(x - d[0], y, z - d[1], 0); }
      this.explode(hx + 0.5, y + 0.5, hz + 0.5, 5, { fire: true, source: null });
      return true;
    }
    p.spawnPoint = { x: hx, y, z: hz };
    const night = w.dayTime >= 12542 && w.dayTime <= 23459 || w.thundering;
    if (!night) { this.hud.setActionBar('You can sleep only at night'); this.hud.addChat('Respawn point set'); return true; }
    if (Math.hypot(hx + 0.5 - p.x, y - p.y, hz + 0.5 - p.z) > 3) { this.hud.setActionBar('You may not rest now; the bed is too far away'); return true; }
    for (const e of this.entities.list) {
      if (e.hostile && !e.dead && Math.abs(e.x - hx) < 8 && Math.abs(e.y - y) < 5 && Math.abs(e.z - hz) < 8) { this.hud.setActionBar('You may not rest now; there are monsters nearby'); return true; }
    }
    p.sleeping = true;
    p.sleepTimer = 0;
    p.bedPos = { x: hx, y, z: hz };
    p.setPos(hx + 0.5, y + 0.5625, hz + 0.5);
    p.vx = p.vy = p.vz = 0;
    this.setScreen(new SleepScreen(this));
    this.hud.addChat('Respawn point set');
    return true;
  }
  tickSleep() {
    const p = this.player, w = this.world;
    if (!p.sleeping) { this.sleepFade = Math.max(0, this.sleepFade - 10); return; }
    p.sleepTimer++;
    this.sleepFade = Math.min(100, p.sleepTimer);
    if (p.bedPos && w.getBlockId(p.bedPos.x, p.bedPos.y, p.bedPos.z) !== B.red_bed) { this.wakeUp(); return; }
    if (p.sleepTimer >= 100) {
      w.time += (24000 - w.dayTime);
      w.dayTime = 0;
      if (w.raining) { w.raining = false; w.thundering = false; }
      this.wakeUp();
    }
  }
  wakeUp() {
    const p = this.player;
    if (!p.sleeping) return;
    p.sleeping = false;
    if (p.bedPos) p.setPos(p.bedPos.x + 0.5, p.bedPos.y + 0.6, p.bedPos.z + 0.5);
    if (this.screen instanceof SleepScreen) this.setScreen(null);
  }

  // ---------- player events ----------
  onPlayerHurt(p, source, amount) {
    this.stats.damageTaken = (this.stats.damageTaken ?? 0) + amount;
    const snd = source.type === 'drown' ? 'entity.player.hurt_drown' : source.type === 'fire' || source.type === 'lava' ? 'entity.player.hurt_on_fire' : 'damage.hit';
    this.sound.play(snd, { x: p.x, y: p.y, z: p.z, pitch: (Math.random() - Math.random()) * 0.2 + 1 });
    if (p.sleeping) this.wakeUp();
  }

  onPlayerDeath(p, source) {
    this.stats.deaths = (this.stats.deaths ?? 0) + 1;
    let msg = DEATH_MESSAGES[source.type] ?? 'Player died';
    const e = source.entity;
    if (e && e !== p) {
      const name = e.type ? e.type[0].toUpperCase() + e.type.slice(1) : 'something';
      if (source.type === 'arrow') msg = `Player was shot by ${name}`;
      else if (source.type === 'explosion') msg = `Player was blown up by ${name}`;
      else msg = `Player was slain by ${name}`;
    } else if (source.type === 'explosion' && source.entity === null) msg = 'Player blew up';
    this.hud.addChat(msg);
    if (!this.world.gamerules.keepInventory) {
      const inv = p.inventory;
      for (let i = 0; i < inv.size; i++) {
        const s = inv.slots[i];
        if (s) {
          const it = new ItemEntity(this.world, s);
          it.setPos(p.x, p.y + 1.3, p.z);
          const f = Math.random() * 0.5, a = Math.random() * Math.PI * 2;
          it.vx = -Math.sin(a) * f; it.vz = Math.cos(a) * f; it.vy = 0.2;
          it.pickupDelay = 40;
          this.entities.add(it);
          inv.slots[i] = null;
        }
      }
      inv.changed();
      const xp = Math.min(100, p.xpLevel * 7);
      if (xp > 0) this.spawnXp(p.x, p.y + 0.5, p.z, xp);
      p.xpLevel = 0; p.xpProgress = 0;
    }
    if (this.screen) this.screen.removed?.();
    this.screen = null;
    this.setScreen(new DeathScreen(this, msg, !!this.worldMeta.hardcore));
  }

  respawn() {
    const p = this.player, w = this.world;
    if (this.worldMeta.hardcore) { p.respawn({ x: p.x, y: p.y, z: p.z }); p.setGamemode('spectator'); this.setScreen(null); return; }
    if (w.dimension !== 'overworld') {
      // beds only work in the Overworld: always return there
      p.respawn({ x: p.x, y: p.y, z: p.z });
      const sp = p.spawnPoint;
      this.enterDimension('overworld', { kind: 'respawn', pos: sp ? { x: sp.x + 0.5, y: sp.y + 0.6, z: sp.z + 0.5 } : null, checkBed: !!sp }, 'Respawning');
      return;
    }
    p.respawn(this.findRespawnPos());
    this.setScreen(null);
  }

  // Validate the player's bed; fall back to world spawn.
  findRespawnPos() {
    const p = this.player, w = this.world;
    if (p.spawnPoint) {
      const sp = p.spawnPoint;
      if (sp.forced || w.getBlockId(sp.x, sp.y, sp.z) === B.red_bed) return { x: sp.x + 0.5, y: sp.y + 0.6, z: sp.z + 0.5 };
      p.spawnPoint = null;
      this.hud.addChat('You have no home bed or charged respawn anchor, or it was obstructed');
    }
    const s = w.spawn;
    let y = s.y;
    if (w.isLoaded(s.x, s.z)) y = w.getTopSolidY(s.x, s.z) + 1;
    return { x: s.x + 0.5, y, z: s.z + 0.5 };
  }
}

// everyday household odds and ends: [item, min, max, weight]
const VILLAGE_LOOT = [
  ['bread', 1, 4, 15], ['wheat', 2, 7, 12], ['wheat_seeds', 2, 8, 12], ['apple', 1, 5, 10], ['carrot', 1, 4, 8], ['potato', 1, 4, 8],
  ['stick', 2, 8, 10], ['oak_planks', 2, 8, 8], ['torch', 1, 6, 8], ['coal', 1, 4, 8], ['cobblestone', 2, 10, 6], ['leather', 1, 3, 5],
  ['string', 1, 4, 5], ['feather', 1, 4, 5], ['flint', 1, 3, 4], ['bone', 1, 3, 4], ['paper', 1, 4, 4], ['oak_sapling', 1, 2, 4],
  ['iron_nugget', 1, 5, 4], ['iron_ingot', 1, 2, 2], ['bucket', 1, 1, 1], ['book', 1, 2, 2], ['cooked_porkchop', 1, 2, 2],
];

function wrapDiff(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('blockcraft.settings') || '{}'); } catch (e) { s = {}; }
  return { ...DEFAULT_SETTINGS, ...s, volume: { ...DEFAULT_SETTINGS.volume, ...(s.volume || {}) } };
}
export { collectBlockTextureNames, ItemById, FallingBlock };
