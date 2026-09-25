// Pool of generation workers with a same-thread fallback.
import { WorldGenerator } from './worldgen/generator.js';

function makeWorker() {
  // Single-file builds inject the worker source as a string.
  if (typeof __GEN_WORKER_SRC__ !== 'undefined') {
    const blob = new Blob([__GEN_WORKER_SRC__], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }
  return new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
}

export class GeneratorPool {
  constructor(seed, options = {}) {
    this.seed = seed;
    this.options = options;
    this.local = new WorldGenerator(seed, options); // used for placeFeature / spawn / fallback
    this.workers = [];
    this.jobs = new Map();
    this.queue = [];
    this.nextId = 1;
    this.useWorkers = options.workers !== false && typeof Worker !== 'undefined';
    const n = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4) - 1));
    if (this.useWorkers) {
      try {
        for (let i = 0; i < n; i++) {
          const w = makeWorker();
          w.busy = 0;
          w.onmessage = (e) => this.onMessage(w, e.data);
          w.onerror = (e) => { console.warn('worker error, falling back to main thread', e.message); this.disableWorkers(); };
          w.postMessage({ type: 'init', seed, options: { type: options.type } });
          this.workers.push(w);
        }
      } catch (e) {
        console.warn('Workers unavailable, generating on main thread', e);
        this.disableWorkers();
      }
    }
    this.capacity = this.useWorkers ? this.workers.length * 3 : 2;
  }

  disableWorkers() {
    if (!this.useWorkers) return;
    this.useWorkers = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.capacity = 2;
    // re-run outstanding jobs locally
    for (const job of this.jobs.values()) this.queue.push(job);
    this.jobs.clear();
  }

  generate(cx, cz) {
    return new Promise((resolve, reject) => {
      const job = { id: this.nextId++, cx, cz, resolve, reject };
      if (this.useWorkers) {
        let best = this.workers[0];
        for (const w of this.workers) if (w.busy < best.busy) best = w;
        best.busy++;
        job.worker = best;
        this.jobs.set(job.id, job);
        best.postMessage({ type: 'gen', id: job.id, cx, cz });
      } else {
        this.queue.push(job);
      }
    });
  }

  onMessage(w, m) {
    if (m.type === 'ready') return;
    const job = this.jobs.get(m.id);
    if (!job) return;
    this.jobs.delete(m.id);
    w.busy--;
    if (m.type === 'error') { job.reject(new Error(m.message)); return; }
    job.resolve(m);
  }

  // Main-thread fallback: generate a few columns per frame within a time budget.
  pump(budgetMs = 8) {
    if (this.useWorkers || this.queue.length === 0) return;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue.shift();
      try { job.resolve(this.local.generateColumn(job.cx, job.cz)); } catch (e) { job.reject(e); }
    }
  }

  placeFeature(access, f) { return this.local.placeFeature(access, f); }
  getSpawnPoint() { return this.local.getSpawnPoint(); }
  getBiomeAt(x, z) { return this.local.getBiomeAt(x, z); }

  destroy() { for (const w of this.workers) w.terminate(); this.workers = []; }
}
