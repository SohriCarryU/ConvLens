import { readImage } from './dataset.ts'
import type { Sample } from './cnn.ts'

type Entry = { file: string; label: string; split: 'train' | 'validation'; revision: string }
export type Dataset = { samples: Sample[]; labels: string[] }

export async function loadFolderDataset(signal?: AbortSignal): Promise<Dataset> {
  const response = await fetch('/training-data/manifest.json', { cache: 'no-store', signal })
  if (!response.ok) throw new Error('无法读取训练素材目录，请检查 public/training-data。')
  const manifest = await response.json()
  if (manifest.version !== 1 || !Array.isArray(manifest.images)) throw new Error('训练素材清单无效。')
  const entries: Entry[] = manifest.images
  for (const entry of entries) {
    const parts = typeof entry?.file === 'string' ? entry.file.split('/') : []
    if (parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\')) || entry.label !== parts[0] || !['train', 'validation'].includes(entry.split)) throw new Error('训练素材路径或标签无效。')
  }
  const labels = [...new Set(entries.map(entry => entry.label))]
  const samples: Sample[] = new Array(entries.length)
  let cursor = 0
  async function worker() {
    while (cursor < entries.length) {
      signal?.throwIfAborted()
      const index = cursor++, entry = entries[index]
      const source = `/training-data/${entry.file.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(entry.revision)}`
      const imageResponse = await fetch(source, { cache: 'no-store', signal })
      if (!imageResponse.ok) throw new Error(`无法读取 ${entry.file}，请检查文件后重新读取。`)
      const blob = await imageResponse.blob()
      const image = await readImage(new File([blob], entry.file, { type: blob.type }))
      samples[index] = { ...image, id: entry.file, label: labels.indexOf(entry.label), split: entry.split, source }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, worker))
  return { samples, labels }
}
