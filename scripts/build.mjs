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

const peerjs = (await readFile(`${root}node_modules/peerjs/dist/peerjs.min.js`, 'utf8')).replace(/<\/script/gi, '<\\/script');
const index = await readFile(`${root}index.html`, 'utf8');
const full = index
  .replace('<script src="node_modules/peerjs/dist/peerjs.min.js"></script>', () => `<script>${peerjs}</script>`)
  .replace('<link rel="stylesheet" href="src/style.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>${script}</script>`);

const head = full.slice(full.indexOf('<head>') + 6, full.indexOf('</head>'));
const body = full.slice(full.indexOf('<body>') + 6, full.lastIndexOf('</body>'));
// Whole elements, not lines: the inlined CSS and JS can span several lines.
const keepHead = (head.match(/<title>[\s\S]*?<\/title>|<link rel="(?:stylesheet|preconnect)"[^>]*>|<style>[\s\S]*?<\/style>/g) || []).join(
  '\n',
);
const fragment = `${keepHead}\n${body}`;

// Refuse to ship a page whose tags don't balance (an unclosed <style> renders as a black screen).
for (const [name, html] of [
  ['sus-station.html', full],
  ['artifact.html', fragment],
]) {
  for (const tag of ['style', 'script']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) throw new Error(`${name}: ${open} <${tag}> but ${close} </${tag}>`);
  }
  if (!html.includes('id="screen"') || !html.includes('<script>')) throw new Error(`${name}: missing page content`);
}

await mkdir(out, { recursive: true });
await writeFile(`${out}sus-station.html`, full);
await writeFile(`${out}artifact.html`, fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/sus-station.html ${kb(full)}, dist/artifact.html ${kb(fragment)}`);
