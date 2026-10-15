import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDataset } from '../scripts/demo-samples.ts'
import { evaluate, forward } from '../src/cnn.ts'
import { Trainer } from '../src/trainer.ts'
import { restoreModel, serializeModel } from '../src/modelStorage.ts'

test('model JSON round-trip preserves parameters, labels, samples and metrics', () => {
  const data = defaultDataset()
  const trainer = new Trainer(data.samples, data.labels)
  trainer.maxEpochs = 1
  while (!trainer.complete) trainer.advance(.05)
  const record = { id: 'model-1', name: '数字模型', trainer, source: 'browser' as const, savedAt: '2026-01-01T00:00:00.000Z' }
  const saved = serializeModel(record)
  const restored = restoreModel(JSON.parse(JSON.stringify(saved)), 'file')
  assert.ok(restored)
  assert.equal(restored.source, 'file')
  assert.equal(restored.name, record.name)
  assert.deepEqual(restored.trainer.labels, trainer.labels)
  assert.deepEqual(restored.trainer.model, trainer.model)
  assert.deepEqual(restored.trainer.metrics, trainer.metrics)
  assert.deepEqual(evaluate(restored.trainer.model, restored.trainer.validation), evaluate(trainer.model, trainer.validation))
  assert.deepEqual(forward(restored.trainer.model, data.samples[0].pixels), forward(trainer.model, data.samples[0].pixels))
})

test('model restore rejects malformed or incompatible files', () => {
  assert.equal(restoreModel({ version: 1, name: 'bad' }), null)
  assert.equal(restoreModel({ version: 999 }), null)
})
