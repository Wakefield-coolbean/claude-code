// Bundles the game (plus its web workers) into one self-contained HTML file: BlockCraft.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';

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
// The bundle is gzipped and base64-embedded; a tiny loader inflates it with DecompressionStream
// and runs it as an inline module. Keeps the single-file download well under 1 MB.
const js = main.outputFiles[0].text;
const packed = zlib.gzipSync(Buffer.from(js, 'utf8'), { level: 9 }).toString('base64');
const loader = `<script>(async()=>{const b=Uint8Array.from(atob(document.getElementById('bc-src').textContent.trim()),c=>c.charCodeAt(0));`
  + `const t=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();`
  + `const s=document.createElement('script');s.type='module';s.textContent=t;document.body.appendChild(s);})()`
  + `.catch(e=>{document.body.insertAdjacentHTML('beforeend','<p style="color:#fff;font:16px sans-serif;padding:20px">This browser cannot unpack the game (needs DecompressionStream support). '+e+'</p>')});</script>`;
const html = fs.readFileSync('index.html', 'utf8')
  .replace('<script type="module" src="src/main.js"></script>', () => `<script type="application/octet-stream" id="bc-src">${packed}</script>\n${loader}`);
fs.writeFileSync('BlockCraft.html', html);
console.log(`BlockCraft.html written (${(html.length / 1024).toFixed(0)} KB; bundle ${(js.length / 1024).toFixed(0)} KB before compression)`);
if (html.length >= 1000000) { console.error('BlockCraft.html exceeds the 1 MB limit'); process.exit(1); }
