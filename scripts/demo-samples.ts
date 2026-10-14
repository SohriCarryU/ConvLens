import { INPUT, random } from '../src/cnn.ts'
import type { Sample } from './cnn.ts'

const digits = [
  ['01110', '11011', '11011', '11011', '11011', '11011', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '11011', '00011', '00110', '01100', '11000', '11111'],
  ['01110', '11011', '00011', '00110', '00011', '11011', '01110'],
  ['00011', '00111', '01011', '11011', '11111', '00011', '00011'],
  ['11111', '11000', '11110', '00011', '00011', '11011', '01110'],
  ['00111', '01100', '11000', '11110', '11011', '11011', '01110'],
  ['11111', '00011', '00110', '01100', '01100', '01100', '01100'],
  ['01110', '11011', '11011', '01110', '11011', '11011', '01110'],
  ['01110', '11011', '11011', '01111', '00011', '00110', '11100'],
]

export function defaultDataset() {
  const rng = random(731)
  const samples: Sample[] = []
  digits.forEach((glyph, label) => {
    for (let n = 0; n < 48; n++) {
      const x = 2 + Math.floor(rng() * 3), y = Math.floor(rng() * 3)
      const intensity = .7 + rng() * .3
      const pixels = Array.from({ length: INPUT * INPUT }, (_, p) => {
        const row = Math.floor((Math.floor(p / INPUT) - y) / 2), col = Math.floor((p % INPUT - x) / 2)
        const v = glyph[row]?.[col] === '1' ? intensity : 0
        return Math.max(0, Math.min(1, v + (rng() - .5) * .15))
      })
      samples.push({ id: `digit-${label}-${n}`, name: `数字 ${label} · ${String(n + 1).padStart(2, '0')}`, label, pixels, split: n % 4 === 0 ? 'validation' : 'train' })
    }
  })
  return { samples, labels: digits.map((_, label) => String(label)) }
}
