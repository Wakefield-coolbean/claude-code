// Module worker: renders sound-effect and piano sample data off the main thread.
// Messages in:  { id, type: 'sfx', name, variant, sr } | { id, type: 'piano', midi } | { id, type: 'ir', sr }
// Messages out: { id, ok: true, data: Float32Array, rate } | { id, ok: false, error }
import { synthesize } from './sfx.js';
import { renderPianoNote, renderReverbIR, PIANO_RATE } from './music.js';

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'sfx') {
      const res = synthesize(m.name, m.variant, m.sr);
      if (!res) throw new Error('unknown sound ' + m.name);
      const data = res.data.byteOffset === 0 && res.data.byteLength === res.data.buffer.byteLength ? res.data : res.data.slice();
      self.postMessage({ id: m.id, ok: true, data, rate: res.rate }, [data.buffer]);
    } else if (m.type === 'piano') {
      const data = renderPianoNote(m.midi, PIANO_RATE);
      self.postMessage({ id: m.id, ok: true, data, rate: PIANO_RATE }, [data.buffer]);
    } else if (m.type === 'ir') {
      const [data, data2] = renderReverbIR(m.sr);
      self.postMessage({ id: m.id, ok: true, data, data2, rate: m.sr }, [data.buffer, data2.buffer]);
    } else if (m.type === 'ping') {
      self.postMessage({ id: m.id, ok: true, pong: true });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
