// Bundles the game (plus its web workers) into one self-contained HTML file: BlockCraft.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, minify: true, target: ['es2020'], legalComments: 'none', logLevel: 'warning' };

async function bundleWorker(entry) {
  const r = await esbuild.build({ ...common, entryPoints: [entry], format: 'iife', write: false });
  return r.outputFiles[0].text;
}

const genWorker = await bundleWorker('src/world/genworker.js');
const synthWorker = await bundleWorker('src/audio/synth-worker.js');
const main = await esbuild.build({
  ...common,
  entryPoints: ['src/main.js'],
  format: 'esm',
  write: false,
  define: {
    __GEN_WORKER_SRC__: JSON.stringify(genWorker),
    __SYNTH_WORKER_SRC__: JSON.stringify(synthWorker),
  },
});
const js = main.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('index.html', 'utf8')
  .replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
fs.writeFileSync('BlockCraft.html', html);
console.log(`BlockCraft.html written (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
