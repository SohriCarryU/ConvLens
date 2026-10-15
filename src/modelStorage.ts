import { Trainer } from './trainer.ts'
import type { Metric } from './trainer.ts'
import type { Parameters, Sample } from './cnn.ts'

const STORAGE_KEY = 'convlens.saved-models.v1'
const MODEL_VERSION = 1

export type SavedModel = {
  version: 1
  id: string
  name: string
  createdAt: string
  savedAt: string
  labels: string[]
  model: Parameters
  samples: Sample[]
  metrics: Metric[]
  steps: number
  epoch: number
  maxEpochs: number
}

export type ModelRecord = {
  id: string
  name: string
  trainer: Trainer
  savedAt?: string
  source: 'browser' | 'file'
}

function copyParameters(model: Parameters): Parameters {
  return {
    kernels: model.kernels.map(row => [...row]),
    convBias: [...model.convBias],
    dense: model.dense.map(row => [...row]),
    denseBias: [...model.denseBias],
  }
}

function copySamples(samples: Sample[]): Sample[] {
  return samples.map(sample => ({
    id: sample.id,
    name: sample.name,
    label: sample.label,
    pixels: [...sample.pixels],
    split: sample.split,
    // Data URLs can be very large and are not needed for model inference.
    source: sample.source,
  }))
}

function isNumberArray(value: unknown, length?: number): value is number[] {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function isParameters(value: unknown, classes: number): value is Parameters {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Parameters>
  return Array.isArray(candidate.kernels) && candidate.kernels.length === 4 && candidate.kernels.every(row => isNumberArray(row, 9))
    && isNumberArray(candidate.convBias, 4)
    && Array.isArray(candidate.dense) && candidate.dense.length === classes && candidate.dense.every(row => isNumberArray(row, 196))
    && isNumberArray(candidate.denseBias, classes)
}

function isSample(value: unknown, labels: number): value is Sample {
  if (!value || typeof value !== 'object') return false
  const sample = value as Partial<Sample>
  return typeof sample.id === 'string' && typeof sample.name === 'string'
    && typeof sample.label === 'number' && Number.isInteger(sample.label) && sample.label >= 0 && sample.label < labels
    && isNumberArray(sample.pixels, 256)
    && (sample.split === 'train' || sample.split === 'validation')
}

export function serializeModel(record: ModelRecord): SavedModel {
  const now = record.savedAt ?? new Date().toISOString()
  return {
    version: MODEL_VERSION,
    id: record.id,
    name: record.name,
    createdAt: now,
    savedAt: now,
    labels: [...record.trainer.labels],
    model: copyParameters(record.trainer.model),
    samples: copySamples(record.trainer.samples),
    metrics: record.trainer.metrics.map(metric => ({ ...metric })),
    steps: record.trainer.steps,
    epoch: record.trainer.epoch,
    maxEpochs: record.trainer.maxEpochs,
  }
}

export function restoreModel(value: unknown, source: 'browser' | 'file' = 'browser'): ModelRecord | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as Partial<SavedModel>
  if (saved.version !== MODEL_VERSION || typeof saved.id !== 'string' || typeof saved.name !== 'string' || !saved.name.trim()) return null
  if (!Array.isArray(saved.labels) || saved.labels.length < 2 || saved.labels.some(label => typeof label !== 'string' || !label.trim())) return null
  if (!isParameters(saved.model, saved.labels.length) || !Array.isArray(saved.samples) || !saved.samples.every(sample => isSample(sample, saved.labels!.length))) return null
  const steps = saved.steps, epoch = saved.epoch
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return null
  const trainer = new Trainer(copySamples(saved.samples), [...saved.labels])
  trainer.model = copyParameters(saved.model)
  trainer.steps = steps
  trainer.epoch = epoch
  const maxEpochs = saved.maxEpochs
  if (typeof maxEpochs === 'number' && Number.isInteger(maxEpochs) && maxEpochs > 0) trainer.maxEpochs = maxEpochs
  trainer.metrics = Array.isArray(saved.metrics) ? saved.metrics.map(metric => ({ ...metric })) : []
  return {
    id: saved.id,
    name: saved.name.trim(),
    trainer,
    savedAt: typeof saved.savedAt === 'string' ? saved.savedAt : new Date().toISOString(),
    source,
  }
}

export function loadStoredModels(): ModelRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      const model = restoreModel(item)
      return model ? [model] : []
    })
  } catch {
    return []
  }
}

export function persistStoredModels(records: ModelRecord[]) {
  if (typeof localStorage === 'undefined') return
  const saved = records.filter(record => record.savedAt).map(serializeModel)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Quota errors are reported by the caller when it explicitly saves a model.
  }
}

export function modelFile(record: ModelRecord) {
  return JSON.stringify(serializeModel(record), null, 2)
}
