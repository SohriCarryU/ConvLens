import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { defaultDataset } from './demo-samples.ts'

// One-time export. Existing files are never overwritten; the app reads these PNGs.
const root = new URL('../public/training-data/', import.meta.url)
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of payload) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4)
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, payload, checksum])
}
function png(pixels) {
  const size = 64, rows = Buffer.alloc((size + 1) * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rows[y * (size + 1) + x + 1] = Math.round(pixels[Math.floor(y / 4) * 16 + Math.floor(x / 4)] * 255)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
let written = 0
for (const [i, sample] of defaultDataset().samples.entries()) {
  const directory = new URL(`${sample.label}/`, root)
  await mkdir(directory, { recursive: true })
  const file = new URL(`digit-${String(i % 48 + 1).padStart(3, '0')}.png`, directory)
  try { await writeFile(file, png(sample.pixels), { flag: 'wx' }); written++ }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
console.log(`Exported ${written} PNG images to ${root.pathname}; existing files preserved.`)
