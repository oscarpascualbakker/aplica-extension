// Genera los iconos provisionales (disco de color con una "A" simple) sin dependencias.
// Uso: node scripts/make-icons.mjs. Los PNG resultantes se versionan en src/icons.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x1f, 0x4f, 0xd8];
const FG = [0xff, 0xff, 0xff];

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// La "A": dos diagonales y un travesaño, en coordenadas normalizadas.
function inLetter(x, y) {
  const nx = (x - 0.5) / 0.5;
  const ny = y;
  if (ny < 0.24 || ny > 0.78) return false;
  const half = 0.06 + ((ny - 0.24) / 0.54) * 0.34;
  const left = Math.abs(Math.abs(nx) * 0.5 - half * 0.5) < 0.05;
  const bar = ny > 0.56 && ny < 0.64 && Math.abs(nx) < half * 0.9;
  return left || bar;
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size;
      const fy = (y + 0.5) / size;
      const inside = Math.hypot(fx - 0.5, fy - 0.5) <= 0.48;
      const px = 1 + x * 4;
      if (!inside) continue;
      const c = inLetter(fx, fy) ? FG : BG;
      row[px] = c[0];
      row[px + 1] = c[1];
      row[px + 2] = c[2];
      row[px + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('src/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`src/icons/icon-${size}.png`, png(size));
}
