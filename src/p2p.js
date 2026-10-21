// Peer-to-peer online play over WebRTC (PeerJS). The host's browser runs the room (the same
// Room the dedicated server uses) and every other player connects straight to it. A public
// PeerJS signaling service only introduces players by room code; game traffic goes
// browser to browser. The host's tab is the server, so the game ends if the host leaves.

import { Link } from './net.js';
import { Room, cleanName } from './room.js';

const PREFIX = 'sus-station-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const OPEN_TIMEOUT = 10000;
const JOIN_TIMEOUT = 15000;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** PeerJS options for a signaling server URL ('' = the free public PeerJS service). */
export function peerOptions(signal) {
  if (!signal) return { debug: 0 };
  const u = new URL(signal);
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  return { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname || '/', secure, debug: 0 };
}

export function p2pAvailable() {
  return typeof window !== 'undefined' && !!window.peerjs?.Peer && typeof RTCPeerConnection !== 'undefined';
}

function friendly(err, signal) {
  const where = signal || 'the free PeerJS service';
  switch (err?.type) {
    case 'browser-incompatible':
      return new Error("This browser can't make peer-to-peer connections. Try Chrome, Firefox or Safari.");
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'timeout':
      return new Error(
        `Can't reach the matchmaking service (${where}) that introduces players. Check your internet connection, or set another one in Settings.`,
      );
    default:
      return err instanceof Error ? err : new Error(String(err?.message || err));
  }
}

function openPeer(id, signal) {
  return new Promise((resolve, reject) => {
    if (!p2pAvailable()) {
      reject(new Error('Peer-to-peer play is not available here. Open the game in a regular browser tab.'));
      return;
    }
    let peer;
    try {
      peer = id ? new window.peerjs.Peer(id, peerOptions(signal)) : new window.peerjs.Peer(peerOptions(signal));
    } catch (err) {
      reject(friendly(err, signal));
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(friendly({ type: 'timeout' }, signal));
    }, OPEN_TIMEOUT);
    peer.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err.type === 'unavailable-id' ? err : friendly(err, signal));
    });
  });
}

/** Steady ticks even when the host's tab is in the background (worker timers aren't throttled). */
export function workerTicker(fn, hz) {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / hz)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = fn;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, 1000 / hz);
    return () => clearInterval(id);
  }
}

const decode = (d) => (typeof d === 'string' ? d : new TextDecoder().decode(d));

/** A guest's data connection, seen by the room as a client. */
function acceptGuest(room, conn) {
  const c = {
    id: `p-${conn.peer}`,
    name: 'Player',
    color: 0,
    joined: false,
    sendRaw: (d) => {
      if (!conn.open) return;
      try {
        conn.send(d);
      } catch {
        /* channel closing */
      }
    },
    send: (m) => c.sendRaw(JSON.stringify(m)),
  };
  let budget = 120; // messages per second
  const refill = setInterval(() => (budget = 120), 1000);
  conn.on('data', (raw) => {
    if (--budget < 0) return;
    let m;
    try {
      m = JSON.parse(decode(raw));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (!c.joined) {
      if (m.t !== 'join') return;
      const why = room.canJoin();
      if (why) {
        c.send({ t: 'err', msg: why });
        setTimeout(() => conn.close(), 300);
        return;
      }
      c.joined = true;
      c.name = cleanName(m.name, 'Player');
      c.color = m.color | 0;
      c.outfit = m.outfit;
      room.add(c);
      return;
    }
    if (m.t === 'leave') return void conn.close();
    if (m.t === 'ping') return c.send({ t: 'pong', c: m.c });
    if (m.t === 'host' || m.t === 'join' || m.t === 'list') return;
    room.onMessage(c, m);
  });
  const gone = () => {
    clearInterval(refill);
    if (c.joined) room.remove(c);
    c.joined = false;
  };
  conn.on('close', gone);
  conn.on('error', gone);
  return { conn, client: c };
}

/**
 * Host a room in this browser. Resolves with a Link for this player's own session;
 * closing it ends the room for everyone.
 */
export async function hostRoom({ name, color, outfit, settings, signal }) {
  let peer = null;
  let code = '';
  for (let i = 0; i < 4 && !peer; i++) {
    code = randomCode();
    try {
      peer = await openPeer(PREFIX + code, signal);
    } catch (err) {
      if (err.type !== 'unavailable-id') throw err;
    }
  }
  if (!peer) throw new Error("Couldn't reserve a room code. Try again.");

  const link = new Link();
  const host = {
    id: 'host',
    name: cleanName(name, 'Host'),
    color,
    outfit,
    sendRaw: (d) => link.receive(d),
    send: (m) => link.receive(JSON.stringify(m)),
  };
  // Peer-to-peer rooms have no public listing; friends join with the code.
  const room = new Room(code, host, { settings, pub: false, ticker: workerTicker }, () => {});
  const guests = new Set();
  peer.on('connection', (conn) => {
    const g = acceptGuest(room, conn);
    guests.add(g);
    conn.on('close', () => guests.delete(g));
  });
  // Stay reachable for new players if the signaling socket drops; open games are unaffected.
  peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
  peer.on('error', (err) => console.warn('peer:', err.type));
  link.send = (d) => {
    let m;
    try {
      m = JSON.parse(d);
    } catch {
      return;
    }
    if (m.t !== 'leave') room.onMessage(host, m);
  };
  link.close = () => {
    room.destroy();
    for (const g of guests) g.conn.close();
    peer.destroy();
    link.closed();
  };
  return link;
}

/** Join a room hosted in another player's browser. Resolves with a Link once connected. */
export async function joinRoom(code, { name, color, outfit, signal }) {
  const peer = await openPeer(null, signal);
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(
      () => fail("Couldn't connect to that game. Check the code; if it's right, one of your networks may be blocking direct connections."),
      JOIN_TIMEOUT,
    );
    peer.on('error', (err) => {
      clearTimeout(timer);
      fail(err.type === 'peer-unavailable' ? 'No game with that code.' : friendly(err, signal).message);
    });
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
    conn.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const link = new Link();
      conn.on('data', (d) => link.receive(decode(d)));
      conn.on('close', () => {
        link.closed();
        peer.destroy();
      });
      link.send = (d) => conn.open && conn.send(d);
      link.close = () => {
        conn.close();
        peer.destroy();
        link.closed();
      };
      link.send(JSON.stringify({ t: 'join', code, name, color, outfit }));
      resolve(link);
    });
  });
}
