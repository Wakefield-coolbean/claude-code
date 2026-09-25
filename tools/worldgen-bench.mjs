// Benchmark world generation: node tools/worldgen-bench.mjs [seed] [size] [type] [centerChunkX] [centerChunkZ]
// Generates a size x size area of chunk columns and prints avg / p95 / max ms per generateColumn.
import { WorldGenerator } from '../src/world/worldgen/generator.js';

const seed = Number(process.argv[2] ?? 12345) | 0;
const size = Number(process.argv[3] ?? 12);
const type = process.argv[4] ?? 'default';
const ccx = Number(process.argv[5] ?? 0), ccz = Number(process.argv[6] ?? 0);

const t0 = performance.now();
const gen = new WorldGenerator(seed, { type });
const tInit = performance.now() - t0;

// warm-up (JIT) on a far-away area so it does not share caches with the measured one
for (let i = 0; i < 6; i++) gen.generateColumn(1000 + i, -1000);

const times = [];
let features = 0;
const half = size >> 1;
for (let cz = ccz - half; cz < ccz + size - half; cz++) {
  for (let cx = ccx - half; cx < ccx + size - half; cx++) {
    const t = performance.now();
    const col = gen.generateColumn(cx, cz);
    times.push(performance.now() - t);
    features += col.features.length;
  }
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
const ts = performance.now();
const spawn = gen.getSpawnPoint();
const tSpawn = performance.now() - ts;
let tb = performance.now();
for (let i = 0; i < 10000; i++) gen.getBiomeAt(i * 7, i * 13);
const tBiome = (performance.now() - tb) / 10000;
console.log(`seed ${seed} type ${type}: ${times.length} columns around chunk ${ccx},${ccz}`);
console.log(`generateColumn  avg ${avg.toFixed(2)} ms  median ${p(0.5).toFixed(2)}  p95 ${p(0.95).toFixed(2)}  max ${times[times.length - 1].toFixed(2)} ms`);
console.log(`features/column ${(features / times.length).toFixed(1)}   init ${tInit.toFixed(1)} ms   getSpawnPoint ${tSpawn.toFixed(1)} ms -> ${JSON.stringify(spawn)}   getBiomeAt ${(tBiome * 1000).toFixed(2)} us`);
