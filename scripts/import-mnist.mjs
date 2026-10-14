import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gunzipSync, deflateSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? new URL('../public/training-data/', import.meta.url).pathname)
const imagesPath = process.argv[3] ?? '/tmp/convlens-mnist.jwsa88/mnist-0.gz'
const labelsPath = process.argv[4] ?? '/tmp/convlens-mnist.jwsa88/mnist-1.gz'
const perClass = Number(process.argv[5] ?? 100)
if (!Number.isInteger(perClass) || perClass < 1 || perClass > 1000) throw new Error('每类数量必须在 1 到 1000 之间')

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

function png(width, height, pixels) {
  const rows = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0
    pixels.copy(rows, y * (width + 1) + 1, y * width, (y + 1) * width)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const images = gunzipSync(await readFile(imagesPath))
const labels = gunzipSync(await readFile(labelsPath))
if (images.readUInt32BE(0) !== 2051 || labels.readUInt32BE(0) !== 2049) throw new Error('不是有效的 MNIST 文件')
const count = Math.min(images.readUInt32BE(4), labels.readUInt32BE(4))
const byLabel = Array.from({ length: 10 }, () => [])
for (let index = 0; index < count; index++) byLabel[labels[8 + index]].push(index)
let seed = 731
const rng = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296 }
const selected = byLabel.map(items => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items.slice(0, perClass)
})
if (selected.some(items => items.length !== perClass)) throw new Error('MNIST 中没有收集到完整的十类样本')

for (let label = 0; label < 10; label++) {
  const directory = join(root, String(label))
  await mkdir(directory, { recursive: true })
  for (let number = 0; number < perClass; number++) {
    const index = selected[label][number]
    const pixels = images.subarray(16 + index * 784, 16 + (index + 1) * 784)
    await writeFile(join(directory, `digit-${String(number + 1).padStart(3, '0')}.png`), png(28, 28, pixels))
  }
}
console.log(`Imported ${perClass * 10} MNIST images into ${root}`)
