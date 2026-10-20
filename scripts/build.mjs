// Bundles the game into single self-contained HTML files:
//   dist/sus-station.html  full document, open it straight from disk
//   dist/artifact.html     body-only fragment for hosts that supply their own <head>
import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/`;

const js = await build({
  entryPoints: [`${root}src/main.js`],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await transform(await readFile(`${root}src/style.css`, 'utf8'), { loader: 'css', minify: true })).code;

const index = await readFile(`${root}index.html`, 'utf8');
const full = index
  .replace('<link rel="stylesheet" href="src/style.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>${script}</script>`);

const head = full.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = full.match(/<body>([\s\S]*?)<\/body>/)[1];
const keepHead = head
  .split('\n')
  .filter((l) => /<title>|<link rel="(stylesheet|preconnect)"|<style>/.test(l))
  .join('\n');
const fragment = `${keepHead}\n${body}`;

await mkdir(out, { recursive: true });
await writeFile(`${out}sus-station.html`, full);
await writeFile(`${out}artifact.html`, fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/sus-station.html ${kb(full)}, dist/artifact.html ${kb(fragment)}`);
