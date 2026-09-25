// Web Worker entry: runs terrain generation off the main thread.
import { WorldGenerator } from './worldgen/generator.js';

let gen = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new WorldGenerator(m.seed, m.options || {});
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'gen') {
    try {
      const r = gen.generateColumn(m.cx, m.cz);
      const transfer = [];
      for (const s of r.sections) if (s) transfer.push(s.buffer);
      transfer.push(r.biomes.buffer);
      if (r.heightmap) transfer.push(r.heightmap.buffer);
      self.postMessage({ type: 'done', id: m.id, cx: m.cx, cz: m.cz, sections: r.sections, biomes: r.biomes, heightmap: r.heightmap, features: r.features }, transfer);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
    }
  }
};
