// Minimal PNG encoder for Node (used by texture preview tools).
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function writePNG(path, w, h, rgba) { fs.writeFileSync(path, encodePNG(w, h, rgba)); }

// Lay out many images into a labelled-free contact sheet, scaled up with nearest neighbour.
// images: [{ w, h, data }], returns { w, h, data }
export function contactSheet(images, { cols = 16, scale = 4, pad = 2, bg = [40, 40, 48, 255] } = {}) {
  const cellW = Math.max(...images.map((i) => i.w)) * scale + pad;
  const cellH = Math.max(...images.map((i) => i.h)) * scale + pad;
  const rows = Math.ceil(images.length / cols);
  const W = cols * cellW + pad, H = rows * cellH + pad;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) out.set(bg, i * 4);
  images.forEach((img, n) => {
    const ox = pad + (n % cols) * cellW, oy = pad + Math.floor(n / cols) * cellH;
    for (let y = 0; y < img.h * scale; y++) for (let x = 0; x < img.w * scale; x++) {
      const si = ((Math.floor(y / scale)) * img.w + Math.floor(x / scale)) * 4;
      const a = img.data[si + 3] / 255;
      // checkerboard behind transparent pixels
      const chk = ((x >> 3) + (y >> 3)) & 1 ? 90 : 60;
      const di = ((oy + y) * W + ox + x) * 4;
      out[di] = img.data[si] * a + chk * (1 - a);
      out[di + 1] = img.data[si + 1] * a + chk * (1 - a);
      out[di + 2] = img.data[si + 2] * a + chk * (1 - a);
      out[di + 3] = 255;
    }
  });
  return { w: W, h: H, data: out };
}
