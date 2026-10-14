import assert from 'node:assert/strict'
import test from 'node:test'
import { backward, createModel, evaluate, forward, loss } from '../src/cnn.ts'
import { defaultDataset } from '../scripts/demo-samples.ts'
import { Trainer } from '../src/trainer.ts'

const testDataset = () => {
  const data = defaultDataset()
  return { samples: data.samples.filter(sample => sample.label < 3), labels: data.labels.slice(0, 3) }
}

test('offline synthetic fixture contains balanced examples for all ten digits', () => {
  const { samples, labels } = defaultDataset()
  assert.deepEqual(labels, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  assert.equal(samples.length, 480)
  for (let label = 0; label < 10; label++) {
    const digit = samples.filter(sample => sample.label === label)
    assert.equal(digit.length, 48)
    assert.equal(digit.filter(sample => sample.split === 'train').length, 36)
    assert.equal(digit.filter(sample => sample.split === 'validation').length, 12)
  }
  assert.equal(createModel(labels.length).dense.length, 10)
})

test('backpropagation agrees with finite differences for convolution, biases, classifier and input', () => {
  const model = createModel(3), sample = defaultDataset().samples[3]
  const gradient = backward(model, sample.pixels, sample.label)
  const eps = 1e-5
  const check = (values: number[], i: number, actual: number) => {
    const original = values[i]
    values[i] = original + eps
    const plus = loss(forward(model, sample.pixels), sample.label)
    values[i] = original - eps
    const minus = loss(forward(model, sample.pixels), sample.label)
    values[i] = original
    const expected = (plus - minus) / (2 * eps)
    assert.ok(Math.abs(actual - expected) < 2e-5, `gradient ${actual} != ${expected}`)
  }
  for (let f = 0; f < 4; f++) {
    for (let k = 0; k < 9; k++) check(model.kernels[f], k, gradient.parameters.kernels[f][k])
    check(model.convBias, f, gradient.parameters.convBias[f])
  }
  for (let c = 0; c < 3; c++) {
    check(model.denseBias, c, gradient.parameters.denseBias[c])
    for (const i of [0, 24, 58, 100, 195]) check(model.dense[c], i, gradient.parameters.dense[c][i])
  }
  for (const i of [0, 34, 71, 123, 220, 255]) check(sample.pixels, i, gradient.input[i])
})

test('inspection is immutable; batch gradients average every sample and commit exactly once', () => {
  const { samples, labels } = testDataset(), trainer = new Trainer(samples, labels)
  const before = JSON.stringify(trainer.model)
  const snap = trainer.prepare(.05)!
  assert.equal(JSON.stringify(trainer.model), before)
  assert.equal(trainer.prepare(.1), snap, 'inspection cannot change the frozen learning rate or snapshot')
  assert.equal(trainer.steps, 0)
  for (let f = 0; f < 4; f++) for (let k = 0; k < 9; k++) {
    const average = snap.traces.reduce((s, t) => s + t.backward.parameters.kernels[f][k], 0) / snap.traces.length
    assert.equal(snap.gradient.kernels[f][k], average)
    assert.equal(snap.after.kernels[f][k], snap.before.kernels[f][k] - snap.rate * average)
  }
  assert.equal(trainer.commit(), true)
  assert.equal(trainer.commit(), false)
  assert.equal(trainer.steps, 1)
  assert.notEqual(JSON.stringify(trainer.model), before)
  assert.equal(trainer.prepare(.05)!.before, snap.after)
})

test('real learning reduces held-out loss and handles the final partial batch and completion', () => {
  const { samples, labels } = testDataset(), trainer = new Trainer(samples, labels)
  const baseline = evaluate(trainer.model, trainer.validation)!
  trainer.maxEpochs = 8
  let iterations = 0
  while (!trainer.complete) {
    const snap = trainer.prepare(.05)!
    assert.ok(snap.traces.every(t => t.sample.split === 'train'))
    assert.ok(snap.traces.every(t => Math.abs(t.forward.probabilities.reduce((a, b) => a + b) - 1) < 1e-10))
    assert.ok(Number.isFinite(snap.lossAfter))
    trainer.commit()
    assert.ok(++iterations < 200)
  }
  const trained = evaluate(trainer.model, trainer.validation)!
  console.log({ baseline, trained, steps: trainer.steps })
  assert.ok(trained.loss < baseline.loss * .5)
  assert.ok(trained.accuracy > 85)
  assert.equal(trainer.metrics.length, 8)
  assert.equal(trainer.steps, 8 * Math.ceil(trainer.train.length / trainer.batchSize))
  assert.equal(trainer.prepare(.05), null)
  const reset = new Trainer(samples, labels)
  assert.deepEqual(evaluate(reset.model, reset.validation), baseline)
})

test('custom labels and pixels participate in training and absent validation is reported as null', () => {
  const samples = defaultDataset().samples.filter(s => s.label < 2 && s.split === 'train').slice(0, 40)
  const trainer = new Trainer(samples, ['猫', '狗'])
  trainer.maxEpochs = 1
  assert.equal(trainer.ready, true)
  while (!trainer.complete) { trainer.prepare(.05); trainer.commit() }
  assert.equal(trainer.metrics[0].val, null)
  assert.equal(forward(trainer.model, samples[0].pixels).probabilities.length, 2)
  assert.equal(new Trainer(samples.filter(s => s.label === 0), ['猫', '狗']).prepare(.05), null)
})

test('training completes when the chart freezes published metric history', () => {
  const { samples, labels } = testDataset(), trainer = new Trainer(samples, labels)
  while (!trainer.complete) {
    const published = trainer.metrics, length = published.length
    Object.freeze(published)
    trainer.prepare(.05)
    trainer.commit()
    assert.equal(published.length, length, 'published history must not be mutated')
  }
  assert.equal(trainer.epoch, 20)
  assert.equal(trainer.steps, 20 * Math.ceil(trainer.train.length / trainer.batchSize))
  assert.equal(trainer.metrics.length, 20)
})

test('live updates publish one fully committed, internally consistent batch at a time', () => {
  const { samples, labels } = testDataset(), trainer = new Trainer(samples, labels)
  const first = trainer.advance(.05)!
  const firstRecord = JSON.stringify(first)
  assert.equal(trainer.latest, first)
  assert.equal(trainer.model, first.after)
  assert.equal(trainer.pending, null)
  assert.equal(trainer.steps, first.step)
  assert.equal(trainer.commit(), false, 'the live update has already been applied')
  const second = trainer.advance(.1)!
  assert.equal(second.before, first.after)
  assert.equal(second.rate, .1)
  assert.equal(second.step, 2)
  assert.equal(trainer.latest, second)
  assert.equal(trainer.model, second.after)
  assert.equal(JSON.stringify(first), firstRecord, 'viewing the previous batch cannot mutate it')
  for (const trace of second.traces) {
    assert.deepEqual(trace.forward, forward(second.before, trace.sample.pixels))
    assert.deepEqual(trace.after, forward(trainer.model, trace.sample.pixels))
    assert.equal(trace.lossAfter, loss(trace.after, trace.sample.label))
  }
})

test('live publication handles partial batches and retains the last completed batch', () => {
  const { samples, labels } = testDataset(), trainer = new Trainer(samples, labels)
  trainer.maxEpochs = 1
  while (!trainer.complete) {
    const snapshot = trainer.advance(.05)!
    assert.equal(snapshot.step, trainer.steps)
    assert.equal(trainer.pending, null)
  }
  const final = trainer.latest
  assert.equal(final?.traces.length, trainer.train.length % trainer.batchSize || trainer.batchSize)
  assert.equal(final?.batch, trainer.batches)
  assert.equal(trainer.advance(.05), null)
  assert.equal(trainer.latest, final)
  assert.equal(trainer.steps, trainer.batches)
  const empty = new Trainer([], [])
  assert.equal(empty.advance(.05), null)
  assert.equal(empty.latest, null)
})
