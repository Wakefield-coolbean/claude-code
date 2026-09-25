// Chat commands (subset of vanilla syntax).
import { Items, ItemById } from '../registry/items.js';
import { Blocks } from '../registry/blocks.js';
import { packBlock } from '../constants.js';
import { ItemStack } from './inventory.js';
import { MOB_TYPES } from '../entity/mobs.js';

const EFFECTS = ['speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost', 'regeneration', 'resistance',
  'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger', 'weakness', 'poison', 'wither', 'absorption', 'saturation', 'levitation', 'slow_falling'];
const ENCHANTS = ['protection', 'fire_protection', 'feather_falling', 'blast_protection', 'projectile_protection', 'respiration', 'aqua_affinity', 'thorns', 'depth_strider',
  'sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'sweeping', 'efficiency', 'silk_touch', 'unbreaking', 'fortune', 'power', 'punch', 'flame', 'infinity', 'mending'];

export class Commands {
  constructor(game) {
    this.game = game;
    this.list = {
      help: { usage: '/help', run: () => this.help() },
      gamemode: { usage: '/gamemode <survival|creative|adventure|spectator>', args: [['survival', 'creative', 'adventure', 'spectator']], run: (a) => this.gamemode(a) },
      time: { usage: '/time <set|add|query> <value>', args: [['set', 'add', 'query'], ['day', 'noon', 'night', 'midnight']], run: (a) => this.time(a) },
      give: { usage: '/give @s <item> [count]', args: [['@s', '@p'], 'items'], run: (a) => this.give(a) },
      tp: { usage: '/tp <x> <y> <z>', run: (a) => this.tp(a) },
      teleport: { usage: '/teleport <x> <y> <z>', run: (a) => this.tp(a) },
      kill: { usage: '/kill [@e]', args: [['@s', '@e']], run: (a) => this.kill(a) },
      summon: { usage: '/summon <entity> [x y z]', args: [Object.keys(MOB_TYPES).concat(['tnt', 'item'])], run: (a) => this.summon(a) },
      weather: { usage: '/weather <clear|rain|thunder>', args: [['clear', 'rain', 'thunder']], run: (a) => this.weather(a) },
      difficulty: { usage: '/difficulty <peaceful|easy|normal|hard>', args: [['peaceful', 'easy', 'normal', 'hard']], run: (a) => this.difficulty(a) },
      effect: { usage: '/effect give @s <effect> [seconds] [amplifier] | /effect clear', args: [['give', 'clear'], ['@s'], EFFECTS], run: (a) => this.effect(a) },
      enchant: { usage: '/enchant @s <enchantment> [level]', args: [['@s'], ENCHANTS], run: (a) => this.enchant(a) },
      clear: { usage: '/clear', run: () => this.clear() },
      xp: { usage: '/xp add @s <amount> [points|levels]', args: [['add', 'set'], ['@s']], run: (a) => this.xp(a) },
      experience: { usage: '/experience add @s <amount> [points|levels]', args: [['add', 'set'], ['@s']], run: (a) => this.xp(a) },
      gamerule: { usage: '/gamerule <rule> [value]', args: [['keepInventory', 'doDaylightCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'doWeatherCycle', 'randomTickSpeed', 'naturalRegeneration']], run: (a) => this.gamerule(a) },
      seed: { usage: '/seed', run: () => this.say(`Seed: [§a${this.game.world.seed}§r]`) },
      spawnpoint: { usage: '/spawnpoint', run: () => this.spawnpoint() },
      setworldspawn: { usage: '/setworldspawn', run: () => this.setworldspawn() },
      setblock: { usage: '/setblock <x> <y> <z> <block>', args: [null, null, null, 'blocks'], run: (a) => this.setblock(a) },
      fill: { usage: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>', args: [null, null, null, null, null, null, 'blocks'], run: (a) => this.fill(a) },
      say: { usage: '/say <message>', run: (a) => this.say(`[Player] ${a.join(' ')}`) },
      heal: { usage: '/heal', run: () => { const p = this.game.player; p.health = p.maxHealth; p.food.food = 20; p.food.saturation = 5; this.say('Healed'); } },
    };
  }

  say(t) { this.game.hud.addChat(t); }
  error(t) { this.game.hud.addChat(`§c${t}`); }

  allowed() {
    const m = this.game.worldMeta;
    return !m || m.cheats || this.game.player.creative;
  }

  run(line) {
    const parts = line.slice(1).trim().split(/\s+/);
    const name = parts.shift().toLowerCase();
    const cmd = this.list[name];
    if (!cmd) { this.error(`Unknown or incomplete command, see below for error\n${line}<--[HERE]`); return; }
    if (name !== 'help' && name !== 'seed' && !this.allowed()) { this.error('You do not have permission to use this command (cheats are off for this world)'); return; }
    try { cmd.run(parts); } catch (e) { console.error(e); this.error(`Usage: ${cmd.usage}`); }
  }

  suggest(text) {
    if (!text.startsWith('/')) return [];
    const parts = text.slice(1).split(' ');
    if (parts.length === 1) return Object.keys(this.list).filter((k) => k.startsWith(parts[0].toLowerCase())).sort();
    const cmd = this.list[parts[0].toLowerCase()];
    if (!cmd || !cmd.args) return [];
    const idx = parts.length - 2;
    let opts = cmd.args[idx];
    if (opts === 'items') opts = ItemById.filter(Boolean).map((i) => i.name);
    if (opts === 'blocks') opts = Object.keys(Blocks);
    if (!opts) return [];
    const cur = parts[parts.length - 1].toLowerCase().replace('minecraft:', '');
    return opts.filter((o) => o.toLowerCase().startsWith(cur)).slice(0, 40);
  }

  help() {
    this.say('§e--- Commands ---');
    for (const c of Object.values(this.list)) this.say(c.usage);
  }

  gamemode([m]) {
    const map = { 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator', s: 'survival', c: 'creative', a: 'adventure', sp: 'spectator' };
    const mode = map[m] ?? m;
    if (!['survival', 'creative', 'adventure', 'spectator'].includes(mode)) throw new Error();
    this.game.player.setGamemode(mode);
    this.say(`Set own game mode to ${mode[0].toUpperCase() + mode.slice(1)} Mode`);
  }

  time([op, v]) {
    const w = this.game.world;
    const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
    if (op === 'query') { this.say(`The time is ${w.dayTime}`); return; }
    let n = named[v] ?? parseInt(v, 10);
    if (isNaN(n)) throw new Error();
    if (op === 'set') w.dayTime = ((n % 24000) + 24000) % 24000;
    else if (op === 'add') { w.dayTime = (w.dayTime + n) % 24000; w.time += n; }
    else throw new Error();
    this.say(`Set the time to ${w.dayTime}`);
  }

  give(a) {
    if (a[0] && a[0].startsWith('@')) a = a.slice(1);
    const name = (a[0] ?? '').replace('minecraft:', '');
    const it = Items[name];
    if (!it) { this.error(`Unknown item '${name}'`); return; }
    const count = Math.max(1, Math.min(6400, parseInt(a[1] ?? '1', 10) || 1));
    let left = count;
    while (left > 0) {
      const n = Math.min(left, it.stack);
      const s = new ItemStack(it.id, n);
      const rem = this.game.player.inventory.add(s);
      if (rem > 0) this.game.dropFromPlayer(new ItemStack(it.id, rem), true);
      left -= n;
    }
    this.game.sound.play('random.pop', { volume: 0.2, pitch: 2 });
    this.say(`Gave ${count} [${it.display}] to Player`);
  }

  coord(s, base) {
    if (s === undefined) throw new Error();
    if (s.startsWith('~')) return base + (s.length > 1 ? parseFloat(s.slice(1)) : 0);
    const v = parseFloat(s);
    if (isNaN(v)) throw new Error();
    return v;
  }

  tp(a) {
    const p = this.game.player;
    if (a[0] && a[0].startsWith('@')) a = a.slice(1);
    const x = this.coord(a[0], p.x), y = this.coord(a[1], p.y), z = this.coord(a[2], p.z);
    p.setPos(Number.isInteger(x) && !a[0].startsWith('~') ? x + 0.5 : x, y, Number.isInteger(z) && !a[2].startsWith('~') ? z + 0.5 : z);
    p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
    this.say(`Teleported Player to ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
  }

  kill([t]) {
    if (t === '@e') {
      let n = 0;
      for (const e of this.game.entities.list) if (!e.isPlayer && !e.removed) { if (e.isLiving) e.hurt({ type: 'kill' }, 1e9); else e.remove(); n++; }
      this.say(`Killed ${n} entities`);
      return;
    }
    this.game.player.hurt({ type: 'kill' }, 1e9);
  }

  summon([type, x, y, z]) {
    const p = this.game.player;
    const px = x !== undefined ? this.coord(x, p.x) : p.x, py = y !== undefined ? this.coord(y, p.y) : p.y, pz = z !== undefined ? this.coord(z, p.z) : p.z;
    type = (type ?? '').replace('minecraft:', '');
    if (type === 'tnt') { this.game.primeTnt(Math.floor(px), Math.floor(py), Math.floor(pz), p); return; }
    if (!MOB_TYPES[type]) { this.error(`Unknown entity '${type}'`); return; }
    const m = this.game.spawnMob(type, px, py, pz);
    if (m) m.persistent = true;
    this.say(`Summoned new ${type[0].toUpperCase() + type.slice(1)}`);
  }

  weather([w]) {
    const wd = this.game.world;
    if (w === 'clear') { wd.raining = false; wd.thundering = false; }
    else if (w === 'rain') { wd.raining = true; wd.thundering = false; }
    else if (w === 'thunder') { wd.raining = true; wd.thundering = true; }
    else throw new Error();
    wd.weatherTimer = 6000 + Math.floor(Math.random() * 12000);
    this.say(`Set the weather to ${w}`);
  }

  difficulty([d]) {
    const i = ['peaceful', 'easy', 'normal', 'hard'].indexOf(d);
    if (i < 0) { this.say(`The difficulty is ${['Peaceful', 'Easy', 'Normal', 'Hard'][this.game.world.difficulty]}`); return; }
    this.game.world.difficulty = i;
    if (this.game.worldMeta) this.game.worldMeta.difficulty = i;
    this.say(`The difficulty has been set to ${d[0].toUpperCase() + d.slice(1)}`);
  }

  effect(a) {
    const p = this.game.player;
    if (a[0] === 'clear') { p.effects.clear(); p.absorption = 0; this.say('Removed every effect from Player'); return; }
    if (a[0] === 'give') a = a.slice(1);
    if (a[0] && a[0].startsWith('@')) a = a.slice(1);
    const id = (a[0] ?? '').replace('minecraft:', '');
    if (!EFFECTS.includes(id)) { this.error(`Unknown effect '${id}'`); return; }
    const secs = parseInt(a[1] ?? '30', 10), amp = parseInt(a[2] ?? '0', 10);
    p.addEffect(id, secs * 20, amp);
    this.say(`Applied effect ${id} to Player`);
  }

  enchant(a) {
    if (a[0] && a[0].startsWith('@')) a = a.slice(1);
    const id = (a[0] ?? '').replace('minecraft:', '');
    if (!ENCHANTS.includes(id)) { this.error(`Unknown enchantment '${id}'`); return; }
    const lvl = parseInt(a[1] ?? '1', 10);
    const s = this.game.player.inventory.held;
    if (!s) { this.error('Player is not holding any item'); return; }
    s.tag = s.tag ?? {};
    s.tag.enchantments = (s.tag.enchantments ?? []).filter((e) => e.id !== id);
    s.tag.enchantments.push({ id, lvl });
    this.game.player.inventory.changed();
    this.say(`Applied enchantment ${id} to Player's item`);
  }

  clear() { this.game.player.inventory.clear(); this.say('Removed items from Player'); }

  xp(a) {
    const p = this.game.player;
    const op = a[0];
    let rest = a.slice(1);
    if (rest[0] && rest[0].startsWith('@')) rest = rest.slice(1);
    const n = parseInt(rest[0], 10);
    const levels = (rest[1] ?? 'points').startsWith('level');
    if (isNaN(n)) throw new Error();
    if (op === 'set') { if (levels) { p.xpLevel = n; } else { p.xpProgress = 0; p.xpLevel = 0; p.giveXp(n); } }
    else if (levels) p.giveLevels(n); else p.giveXp(n);
    this.say(`Gave ${n} experience ${levels ? 'levels' : 'points'} to Player`);
  }

  gamerule([rule, value]) {
    const g = this.game.world.gamerules;
    if (!(rule in g)) { this.error(`Unknown game rule '${rule}'`); return; }
    if (value === undefined) { this.say(`Gamerule ${rule} is currently set to: ${g[rule]}`); return; }
    g[rule] = typeof g[rule] === 'boolean' ? value === 'true' : parseInt(value, 10);
    this.say(`Gamerule ${rule} is now set to: ${g[rule]}`);
  }

  spawnpoint() {
    const p = this.game.player;
    p.spawnPoint = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), forced: true };
    this.say(`Set spawn point to ${p.spawnPoint.x}, ${p.spawnPoint.y}, ${p.spawnPoint.z}`);
  }
  setworldspawn() {
    const p = this.game.player;
    this.game.world.spawn = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    this.say('Set the world spawn point');
  }

  parseBlock(s) {
    const [name, meta] = (s ?? '').replace('minecraft:', '').split(':');
    const b = Blocks[name];
    if (!b) throw new Error(`Unknown block '${name}'`);
    return packBlock(b.id, parseInt(meta ?? '0', 10) || 0);
  }

  setblock(a) {
    const p = this.game.player;
    const x = Math.floor(this.coord(a[0], p.x)), y = Math.floor(this.coord(a[1], p.y)), z = Math.floor(this.coord(a[2], p.z));
    let v;
    try { v = this.parseBlock(a[3]); } catch (e) { this.error(e.message); return; }
    this.game.world.setBlock(x, y, z, v);
    this.say('Changed the block');
  }

  fill(a) {
    const p = this.game.player;
    const c = [0, 1, 2, 3, 4, 5].map((i) => Math.floor(this.coord(a[i], [p.x, p.y, p.z][i % 3])));
    let v;
    try { v = this.parseBlock(a[6]); } catch (e) { this.error(e.message); return; }
    const [x0, x1] = [Math.min(c[0], c[3]), Math.max(c[0], c[3])];
    const [y0, y1] = [Math.min(c[1], c[4]), Math.max(c[1], c[4])];
    const [z0, z1] = [Math.min(c[2], c[5]), Math.max(c[2], c[5])];
    const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (n > 32768) { this.error(`Too many blocks in the specified area (maximum 32768, specified ${n})`); return; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.game.world.setBlock(x, y, z, v);
    this.say(`Successfully filled ${n} blocks`);
  }
}
