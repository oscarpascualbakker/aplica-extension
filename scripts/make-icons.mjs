// Iconos de la barra (CV-544): el isotipo de la marca, sin margen, a 16, 32 y 48 px.
// Uso: node scripts/make-icons.mjs (no forma parte del build; los PNG se suben al repositorio).
//
// La geometría es la del favicon de la marca (`aplica-logo/web/favicon.svg` del repositorio de la web):
// dos hojas de 56 x 72 con esquinas de radio 10, desplazadas 24 y 16, dentro de un cuadrado de 88 en el
// que la forma ocupa todo el alto. La zona de encaje es la intersección de las dos hojas. Antes, los
// iconos pequeños salían del isotipo con su área de respeto y se veían más pequeños que los de otras
// extensiones.
//
// `icon-128.png` no se genera: es el icono de la tienda, con 96 px de dibujo y 16 px transparentes
// alrededor, como pide la Chrome Web Store (store/README.md).
//
// Sin dependencias: muestreo 8 x 8 por píxel para suavizar los bordes y PNG con zlib de Node.

import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const PALETTES = {
  // Versión en color, para barras claras.
  color: { back: [0x1e, 0x1b, 0x4b], front: [0x6d, 0x5b, 0xd0], fit: [0xd9, 0xd5, 0xfa] },
  // Versión en negativo, para barras oscuras (Firefox, theme_icons).
  negativo: { back: [0xf4, 0xf2, 0xff], front: [0x7c, 0x6a, 0xe6], fit: [0xbd, 0xb4, 0xf7] },
};

const BOX = 88;
const OFFSET_X = 4;
const BACK = { x0: 0, y0: 0, x1: 56, y1: 72 };
const FRONT = { x0: 24, y0: 16, x1: 80, y1: 88 };
const RADIUS = 10;
const SAMPLES = 8;

function inRoundedRect(x, y, r) {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false;
  const cx = Math.min(Math.max(x, r.x0 + RADIUS), r.x1 - RADIUS);
  const cy = Math.min(Math.max(y, r.y0 + RADIUS), r.y1 - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

/** RGBA del icono de `size` px (alfa premultiplicado al promediar, sin halos en los bordes). */
function render(size, palette) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = BOX / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale - OFFSET_X;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          const back = inRoundedRect(x, y, BACK);
          const front = inRoundedRect(x, y, FRONT);
          const color = back && front ? palette.fit : front ? palette.front : back ? palette.back : null;
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
        pixels[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
      }
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // sin filtro
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48]) {
  writeFileSync(`src/icons/icon-${size}.png`, png(size, render(size, PALETTES.color)));
}
for (const size of [16, 32]) {
  writeFileSync(`src/icons/icon-${size}-negativo.png`, png(size, render(size, PALETTES.negativo)));
}
console.log('src/icons: 16, 32 y 48 en color; 16 y 32 en negativo');
