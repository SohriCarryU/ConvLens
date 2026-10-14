import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanTrainingFiles } from '../scripts/training-files.mjs'

test('checked-in training assets include 100 images for every digit from 0 to 9', async () => {
  const root = fileURLToPath(new URL('../public/training-data/', import.meta.url))
  const manifest = await scanTrainingFiles(root)
  assert.equal(manifest.images.length, 1000)
  assert.deepEqual([...new Set(manifest.images.map(image => image.label))], ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  for (let digit = 0; digit < 10; digit++) {
    const samples = manifest.images.filter(image => image.label === String(digit))
    assert.equal(samples.length, 100)
    assert.equal(samples.filter(image => image.split === 'train').length, 75)
    assert.equal(samples.filter(image => image.split === 'validation').length, 25)
  }
})

test('folder labels, image discovery and holdout split reflect files on disk', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'convlens-data-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, '0', 'nested'), { recursive: true })
  await mkdir(join(directory, '猫 图'))
  await mkdir(join(directory, '.hidden'))
  for (const name of ['10.png', '2.PNG', '1.jpg', 'nested/4.webp']) await writeFile(join(directory, '0', name), 'image fixture')
  await writeFile(join(directory, '猫 图', 'cat.jpeg'), 'image fixture')
  await writeFile(join(directory, 'loose.png'), 'not in a label folder')
  await writeFile(join(directory, '0', 'notes.txt'), 'not an image')
  await writeFile(join(directory, '0', '.hidden.png'), 'hidden')
  await writeFile(join(directory, '.hidden', 'image.png'), 'hidden')
  await symlink(join(directory, '0', '1.jpg'), join(directory, '猫 图', 'linked.png'))
  const first = await scanTrainingFiles(directory)
  assert.equal(first.images.length, 5)
  assert.deepEqual(first.images.slice(0, 4).map(image => image.file), ['0/1.jpg', '0/2.PNG', '0/10.png', '0/nested/4.webp'])
  assert.deepEqual(first.images.slice(0, 4).map(image => image.split), ['train', 'train', 'train', 'validation'])
  assert.equal(first.images[4].label, '猫 图')
  assert.equal(first.images[4].split, 'train', 'a small class must still have training samples')

  await writeFile(join(directory, '猫 图', 'new.png'), 'new image')
  await writeFile(join(directory, '0', '1.jpg'), 'replacement with a different size')
  const second = await scanTrainingFiles(directory)
  assert.equal(second.images.length, 6, 'new files are discovered without restarting')
  assert.notEqual(second.images[0].revision, first.images[0].revision, 'replacements invalidate image URLs')
  await rm(join(directory, '猫 图', 'new.png'))
  assert.equal((await scanTrainingFiles(directory)).images.length, 5)
  assert.deepEqual(await scanTrainingFiles(join(directory, 'missing')), { version: 1, images: [] })
})
