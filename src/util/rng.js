// Deterministic pseudo random helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash of up to 4 ints -> uint32
export function hash4(a, b = 0, c = 0, d = 0) {
  let h = 0x811c9dc5 ^ (a | 0);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= b | 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= c | 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= d | 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Hash -> float in [0,1)
export function hashFloat(a, b = 0, c = 0, d = 0) {
  return hash4(a, b, c, d) / 4294967296;
}

export function stringSeed(str) {
  if (/^-?\d+$/.test(str.trim())) return Number(str.trim()) | 0;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

export class Random {
  constructor(seed = (Math.random() * 2 ** 32) | 0) {
    this._next = mulberry32(seed);
    this._haveGauss = false;
    this._gauss = 0;
  }
  float() { return this._next(); }
  nextFloat() { return this._next(); }
  int(n) { return Math.floor(this._next() * n); }
  nextInt(n) { return Math.floor(this._next() * n); }
  range(min, max) { return min + Math.floor(this._next() * (max - min + 1)); }
  bool() { return this._next() < 0.5; }
  chance(p) { return this._next() < p; }
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  gaussian() {
    if (this._haveGauss) { this._haveGauss = false; return this._gauss; }
    let v1, v2, s;
    do {
      v1 = 2 * this._next() - 1;
      v2 = 2 * this._next() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this._gauss = v2 * m; this._haveGauss = true;
    return v1 * m;
  }
}
