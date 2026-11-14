// Generates PNG app icons with no image dependencies (zlib + hand-rolled PNG chunks).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, pad: number, file: string) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const bg = [11, 13, 16], green = [47, 209, 122], red = [255, 92, 92], blue = [79, 163, 255];
  const bars = [0.35, 0.55, 0.42, 0.7, 0.62, 0.86];
  const inner = size * (1 - 2 * pad), x0 = size * pad;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = bg;
      const u = (x - x0) / inner, v = (y - x0) / inner;
      if (u >= 0.12 && u < 0.88 && v >= 0.12 && v < 0.88) {
        const slot = Math.floor((u - 0.12) / (0.76 / bars.length));
        const within = ((u - 0.12) / (0.76 / bars.length)) % 1;
        const h = bars[Math.min(slot, bars.length - 1)];
        if (within > 0.18 && within < 0.82 && 0.88 - v < h * 0.76) col = slot === 2 ? red : green;
        if (Math.abs(v - (0.88 - 0.76 * 0.5)) < 0.008) col = blue;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]));
}
png(192, 0.04, 'public/icons/icon-192.png');
png(512, 0.04, 'public/icons/icon-512.png');
png(512, 0.12, 'public/icons/maskable-512.png');
png(180, 0.04, 'public/icons/apple-touch-icon.png');
console.log('icons written');
