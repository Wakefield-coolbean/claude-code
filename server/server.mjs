// Sus Station server: serves the game and runs online rooms over WebSockets.
// usage: npm start            (PORT=8080 by default)
// Players open http://<this machine>:8080, pick Online, and host or join with a code.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Room, cleanName } from '../src/room.js';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]?$/, sep);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const PUBLIC = ['index.html', 'src', 'dist', 'dev'];
const PEERJS = 'node_modules/peerjs/dist/peerjs.min.js';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Start the HTTP + WebSocket server. Resolves once it is listening. */
export function startServer({ port = 8080, quiet = false } = {}) {
  const rooms = new Map();

  // ---------- static files ----------
  const http = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
      if (path === 'health') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      const rel = path === '' ? 'index.html' : path;
      const vendor = rel === PEERJS;
      if (rel.includes('..') || (!vendor && !PUBLIC.includes(rel.split(/[/\\]/)[0]))) throw new Error('not public');
      let file = join(root, rel);
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      if (!file.startsWith(root)) throw new Error('outside root');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });

  // ---------- websockets ----------
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

  function newCode() {
    for (;;) {
      const bytes = randomBytes(6);
      const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (!rooms.has(code)) return code;
    }
  }

  let nextId = 1;
  wss.on('connection', (ws) => {
    const c = {
      id: `c${nextId++}`,
      name: 'Player',
      color: 0,
      room: null,
      sendRaw: (data) => ws.readyState === ws.OPEN && ws.send(data),
      send: (msg) => c.sendRaw(JSON.stringify(msg)),
    };
    let budget = 120; // messages per second
    const refill = setInterval(() => (budget = 120), 1000);

    ws.on('message', (data) => {
      if (--budget < 0) return;
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (!m || typeof m.t !== 'string') return;
      handle(c, m);
    });
    ws.on('close', () => {
      clearInterval(refill);
      c.room?.remove(c);
    });
  });

  function handle(c, m) {
    switch (m.t) {
      case 'ping':
        return c.send({ t: 'pong', c: m.c });
      case 'list':
        return c.send({ t: 'list', rooms: [...rooms.values()].filter((r) => r.pub && !r.canJoin()).map((r) => r.info()) });
      case 'host': {
        c.room?.remove(c);
        c.name = cleanName(m.name, 'Player');
        c.color = m.color | 0;
        c.outfit = m.outfit;
        const code = newCode();
        rooms.set(code, new Room(code, c, { settings: m.settings, pub: m.pub }, (r) => rooms.delete(r.code)));
        return;
      }
      case 'join': {
        const room = rooms.get(
          String(m.code || '')
            .toUpperCase()
            .trim(),
        );
        if (!room) return c.send({ t: 'err', msg: 'No game with that code.' });
        const why = room.canJoin();
        if (why) return c.send({ t: 'err', msg: why });
        c.room?.remove(c);
        c.name = cleanName(m.name, 'Player');
        c.color = m.color | 0;
        c.outfit = m.outfit;
        room.add(c);
        return;
      }
      case 'leave':
        return c.room?.remove(c);
      default:
        return c.room?.onMessage(c, m);
    }
  }

  // Drop dead connections.
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAliveFlag === false) {
        ws.terminate();
        continue;
      }
      ws.isAliveFlag = false;
      ws.ping();
    }
  }, 20000);
  wss.on('connection', (ws) => {
    ws.isAliveFlag = true;
    ws.on('pong', () => (ws.isAliveFlag = true));
  });

  const timers = [sweep];
  return new Promise((resolve) => {
    http.listen(port, () => {
      const actual = http.address().port;
      if (!quiet) console.log(`Sus Station server on http://localhost:${actual} (WebSocket at /ws)`);
      resolve({
        port: actual,
        rooms,
        close: () => {
          for (const r of rooms.values()) r.destroy();
          timers.forEach(clearInterval);
          wss.close();
          http.close();
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({ port: Number(process.env.PORT) || 8080 });
}
