// World persistence in IndexedDB (falls back to memory when IndexedDB is unavailable).
import { SECTION_COUNT } from '../constants.js';

const DB_NAME = 'blockcraft';
const DB_VERSION = 1;

function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return Uint16Array.from(out);
}
function rleDecode(enc, len = 4096) {
  const out = new Uint16Array(len);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) { out.fill(enc[i], o, o + enc[i + 1]); o += enc[i + 1]; }
  return out;
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export class Storage {
  static async open() {
    const s = new Storage();
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
      s.db = await new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
        setTimeout(() => rej(new Error('indexedDB timeout')), 4000);
      });
    } catch (e) {
      console.warn('IndexedDB unavailable, worlds will not persist:', e.message);
      s.memory = { worlds: new Map(), chunks: new Map() };
    }
    return s;
  }

  get persistent() { return !this.memory; }

  async listWorlds() {
    if (this.memory) return [...this.memory.worlds.values()];
    const tx = this.db.transaction('worlds', 'readonly');
    return reqP(tx.objectStore('worlds').getAll());
  }
  async getWorld(id) {
    if (this.memory) return this.memory.worlds.get(id);
    return reqP(this.db.transaction('worlds', 'readonly').objectStore('worlds').get(id));
  }
  async saveWorldMeta(meta) {
    const copy = JSON.parse(JSON.stringify(meta));
    if (this.memory) { this.memory.worlds.set(meta.id, copy); return; }
    const tx = this.db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(copy);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async deleteWorld(id) {
    if (this.memory) {
      this.memory.worlds.delete(id);
      for (const k of [...this.memory.chunks.keys()]) if (k.startsWith(id + ':')) this.memory.chunks.delete(k);
      return;
    }
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    const range = IDBKeyRange.bound(id + ':', id + ':￿');
    tx.objectStore('chunks').delete(range);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  chunkKey(worldId, cx, cz) { return `${worldId}:${cx}:${cz}`; }

  serializeChunk(c, entities) {
    const sections = [];
    for (let i = 0; i < SECTION_COUNT; i++) sections.push(c.sections[i] ? rleEncode(c.sections[i]) : null);
    const bes = [];
    for (const [k, be] of c.blockEntities) bes.push([k, serializeBE(be)]);
    return { v: 1, sections, biomes: c.biomes, features: c.features, blockEntities: bes, entities: entities ?? [] };
  }

  async saveChunk(worldId, c, entities) {
    const data = this.serializeChunk(c, entities);
    const key = this.chunkKey(worldId, c.cx, c.cz);
    if (this.memory) { this.memory.chunks.set(key, data); return; }
    try {
      const tx = this.db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put(data, key);
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { console.warn('chunk save failed', e); }
  }

  async loadChunk(worldId, cx, cz) {
    const key = this.chunkKey(worldId, cx, cz);
    let data;
    if (this.memory) data = this.memory.chunks.get(key);
    else data = await reqP(this.db.transaction('chunks', 'readonly').objectStore('chunks').get(key));
    if (!data) return null;
    return {
      sections: data.sections.map((s) => (s ? rleDecode(s) : null)),
      biomes: data.biomes instanceof Uint8Array ? data.biomes : new Uint8Array(data.biomes),
      features: data.features ?? [],
      blockEntities: (data.blockEntities ?? []).map(([k, be]) => [k, deserializeBE(be)]),
      entities: data.entities ?? [],
    };
  }
}

// Block entities are plain objects with an Inventory; convert for storage
import { Inventory, ItemStack } from '../game/inventory.js';
export function serializeBE(be) {
  const o = { ...be };
  if (be.inventory) o.inventory = be.inventory.serialize();
  delete o.viewers;
  return o;
}
export function deserializeBE(o) {
  const be = { ...o };
  if (o.inventory) {
    const inv = new Inventory(o.inventory.length);
    inv.slots = o.inventory.map((s) => ItemStack.deserialize(s));
    be.inventory = inv;
  }
  return be;
}
