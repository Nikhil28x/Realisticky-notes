// Script to generate a simple 16x16 tray icon PNG
// Run once with: node scripts/gen-icon.js
'use strict';

const fs = require('fs');
const path = require('path');

// Minimal 16x16 yellow square PNG (hand-crafted binary)
// PNG signature + IHDR + IDAT + IEND

function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const len = u32(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = u32(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// 16x16 RGBA image — yellow (#FDFD96) with slight transparency
const W = 16, H = 16;
const pixels = [];
for (let y = 0; y < H; y++) {
  pixels.push(0); // filter byte
  for (let x = 0; x < W; x++) {
    const isEdge = x === 0 || x === W - 1 || y === 0 || y === H - 1;
    pixels.push(0xFD, 0xFD, 0x96, isEdge ? 0xCC : 0xFF); // RGBA
  }
}

// Deflate-compress (using Node's zlib)
const zlib = require('zlib');
const raw = Buffer.from(pixels);
const compressed = zlib.deflateSync(raw, { level: 9 });

const ihdr = chunk('IHDR', Buffer.concat([
  u32(W), u32(H),
  Buffer.from([8, 6, 0, 0, 0]) // 8-bit RGBA, no interlace
]));
const idat = chunk('IDAT', compressed);
const iend = chunk('IEND', Buffer.alloc(0));

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([sig, ihdr, idat, iend]);

const outPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
fs.writeFileSync(outPath, png);
console.log('tray-icon.png written to', outPath);
