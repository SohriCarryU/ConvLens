import { applyGradient, backward, createModel, evaluate, forward, loss, mapParameters, random, valueAt } from './cnn.ts'
import type { Backward, Forward, Parameters, Sample } from './cnn.ts'

export type Trace = { sample: Sample; forward: Forward; backward: Backward; after: Forward; loss: number; lossAfter: number }
export type Snapshot = { step: number; epoch: number; batch: number; rate: number; before: Parameters; after: Parameters; gradient: Parameters; traces: Trace[]; loss: number; lossAfter: number }
export type Metric = { epoch: number; loss: number; accuracy: number; val: number | null; valLoss: number | null }

export class Trainer {
  model: Parameters
  samples: Sample[]
  labels: string[]
  train: Sample[]
  validation: Sample[]
  batchSize = 16
  maxEpochs = 20
  epoch = 0
  steps = 0
  cursor = 0
  pending: Snapshot | null = null
  latest: Snapshot | null = null
  metrics: Metric[] = []
  private rng = random(213)
  private order: Sample[]

  constructor(samples: Sample[], labels: string[]) {
    this.samples = samples
    this.labels = labels
    this.train = samples.filter(s => s.split === 'train')
    this.validation = samples.filter(s => s.split === 'validation')
    this.model = createModel(labels.length)
    this.order = this.shuffle(this.train)
  }

  get ready() { return this.labels.length >= 2 && this.labels.every((_, i) => this.train.some(s => s.label === i)) }
  get complete() { return this.epoch >= this.maxEpochs }
  get batches() { return Math.ceil(this.train.length / this.batchSize) }

  // Publish only fully applied batches so every live panel refers to the same update.
  advance(rate: number): Snapshot | null {
    const snapshot = this.prepare(rate)
    if (!snapshot) return null
    this.commit()
    return snapshot
  }

  private shuffle(samples: Sample[]) {
    const result = [...samples]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  prepare(rate: number): Snapshot | null {
    if (this.pending) return this.pending
    if (this.complete || !this.ready) return null
    if (!Number.isFinite(rate) || rate <= 0 || rate > .2) throw new Error('学习率应在 0 到 0.2 之间')
    const batch = this.order.slice(this.cursor, this.cursor + this.batchSize)
    const before = this.model
    const computations = batch.map(sample => {
      const result = forward(before, sample.pixels)
      return { sample, forward: result, backward: backward(before, sample.pixels, sample.label, result), loss: loss(result, sample.label) }
    })
    const gradient = mapParameters(before, (_, group, row, col) => computations.reduce((sum, t) => sum + valueAt(t.backward.parameters, group, row, col), 0) / batch.length)
    const after = applyGradient(before, gradient, rate)
    const traces = computations.map(t => {
      const next = forward(after, t.sample.pixels)
      return { ...t, after: next, lossAfter: loss(next, t.sample.label) }
    })
    this.pending = {
      step: this.steps + 1, epoch: this.epoch + 1, batch: Math.floor(this.cursor / this.batchSize) + 1,
      rate, before, after, gradient, traces,
      loss: traces.reduce((s, t) => s + t.loss, 0) / traces.length,
      lossAfter: traces.reduce((s, t) => s + t.lossAfter, 0) / traces.length,
    }
    return this.pending
  }

  commit() {
    const snapshot = this.pending
    if (!snapshot) return false
    if (snapshot.step !== this.steps + 1) throw new Error('训练快照与当前模型不一致')
    this.model = snapshot.after
    this.steps++
    this.cursor += snapshot.traces.length
    this.latest = snapshot
    this.pending = null
    if (this.cursor >= this.train.length) {
      this.epoch++
      const training = evaluate(this.model, this.train)!
      const validation = evaluate(this.model, this.validation)
      // Chart consumers may freeze their inputs. Keep previously published history immutable.
      this.metrics = [...this.metrics, { epoch: this.epoch, ...training, val: validation?.accuracy ?? null, valLoss: validation?.loss ?? null }]
      this.cursor = 0
      this.order = this.shuffle(this.train)
    }
    return true
  }
}
