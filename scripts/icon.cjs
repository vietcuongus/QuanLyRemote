// Dependency-free rasterization of our own geometric SVG logo, for Windows' ICO format.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = data => { let c = 0xffffffff; for (const value of data) c = table[(c ^ value) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const name = Buffer.from(type); const header = Buffer.alloc(4), footer = Buffer.alloc(4); header.writeUInt32BE(data.length); footer.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([header, name, data, footer]); };
const distance = (x, y, ax, ay, bx, by) => { const length = (bx - ax) ** 2 + (by - ay) ** 2; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length)); return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)); };
function png(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / size * 256, py = (y + (sy + .5) / 4) / size * 256;
      const qx = Math.abs(px - 128) - 64, qy = Math.abs(py - 128) - 64;
      const signed = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 52;
      if (signed > 1.5) continue;
      let color;
      if (Math.abs(signed) < 1.5) color = [31, 113, 105];
      else {
        const grad = (px + py) / 512;
        color = [22 - grad * 10, 59 - grad * 43, 62 - grad * 40];
        if (Math.min(distance(px, py, 76, 83, 111, 118), distance(px, py, 111, 118, 76, 153), distance(px, py, 126, 153, 179, 153)) < 6.5) color = [153 - grad * 108, 246 - grad * 34, 228 - grad * 37];
      }
      r += color[0]; g += color[1]; b += color[2]; a++;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (a) { rows[offset] = Math.round(r / a); rows[offset + 1] = Math.round(g / a); rows[offset + 2] = Math.round(b / a); rows[offset + 3] = Math.round(a / 16 * 255); }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [32, 48, 64, 128, 256], images = sizes.map(png);
const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) { const start = 6 + i * 16; header[start] = sizes[i] === 256 ? 0 : sizes[i]; header[start + 1] = header[start]; header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(images[i].length, start + 8); header.writeUInt32LE(offset, start + 12); offset += images[i].length; }
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(root, 'build/icon.png'), images.at(-1));
