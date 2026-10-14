import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTrainingFolderMiddleware } from '../scripts/open-training-folder.mjs'

async function invoke(directory: string, options: { method?: string; origin?: string; remoteAddress?: string; action?: string } = {}, open?: (path: string) => Promise<void>) {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(value: string) { this.body = value },
  }
  let nextCalled = false
  const request = {
    url: '/__convlens/open-training-folder?from=button',
    method: options.method ?? 'POST',
    headers: {
      host: 'localhost:5173',
      origin: options.origin === undefined ? 'http://localhost:5173' : options.origin,
      'x-convlens-action': options.action === undefined ? 'open-training-folder' : options.action,
    },
    socket: { encrypted: false, remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  }
  await openTrainingFolderMiddleware(directory, open)(request as never, response as never, () => { nextCalled = true })
  return { ...response, json: JSON.parse(response.body), nextCalled }
}

test('opens only the fixed directory for a same-origin request from this computer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'convlens-open-test-'))
  const directory = join(root, 'training-data')
  await mkdir(directory)
  t.after(() => rm(root, { recursive: true, force: true }))
  const opened: string[] = []
  const response = await invoke(directory, {}, async path => { opened.push(path) })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json, { opened: true })
  assert.deepEqual(opened, [directory])
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('rejects remote, cross-origin, unmarked and non-POST requests without opening anything', async t => {
  const root = await mkdtemp(join(tmpdir(), 'convlens-open-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const open = async () => { calls++ }
  const remote = await invoke(root, { remoteAddress: '192.0.2.4' }, open)
  const crossOrigin = await invoke(root, { origin: 'http://example.com' }, open)
  const unmarked = await invoke(root, { action: '' }, open)
  const get = await invoke(root, { method: 'GET' }, open)
  assert.deepEqual([remote.statusCode, crossOrigin.statusCode, unmarked.statusCode, get.statusCode], [403, 403, 403, 405])
  assert.equal(get.headers.Allow, 'POST')
  assert.equal(calls, 0)
})

test('reports missing directories and file-manager failures instead of claiming success', async t => {
  const root = await mkdtemp(join(tmpdir(), 'convlens-open-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const missing = await invoke(join(root, 'missing'))
  const failed = await invoke(root, {}, async () => { throw new Error('finder failed') })
  assert.equal(missing.statusCode, 404)
  assert.equal(failed.statusCode, 500)
  assert.notEqual(failed.json.opened, true)
})
