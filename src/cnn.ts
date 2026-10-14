// A small, fully differentiable CNN. Every displayed tensor comes from this engine.
export const INPUT = 16
export const KERNEL = 3
export const CONV = INPUT - KERNEL + 1
export const FILTERS = 4
export const POOL = CONV / 2
export const FEATURES = FILTERS * POOL * POOL

export type Sample = { id: string; name: string; label: number; pixels: number[]; split: 'train' | 'validation'; original?: string; source?: string }
export type Parameters = { kernels: number[][]; convBias: number[]; dense: number[][]; denseBias: number[] }
export type Forward = { conv: number[][]; activated: number[][]; pooled: number[]; logits: number[]; probabilities: number[] }
export type Backward = { parameters: Parameters; logits: number[]; pooled: number[]; conv: number[][]; input: number[] }
export const zeros = (n: number) => Array<number>(n).fill(0)
export const argmax = (values: number[]) => values.indexOf(Math.max(...values))

export function random(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

export function createModel(classes: number, seed = 42): Parameters {
  const rng = random(seed)
  const uniform = (scale: number) => (rng() * 2 - 1) * scale
  return {
    kernels: Array.from({ length: FILTERS }, () => Array.from({ length: 9 }, () => uniform(Math.sqrt(6 / 9)))),
    convBias: Array(FILTERS).fill(.05),
    dense: Array.from({ length: classes }, () => Array.from({ length: FEATURES }, () => uniform(Math.sqrt(6 / FEATURES)))),
    denseBias: zeros(classes),
  }
}

export function mapParameters(model: Parameters, fn: (v: number, group: keyof Parameters, row: number, col: number) => number): Parameters {
  return {
    kernels: model.kernels.map((r, i) => r.map((v, j) => fn(v, 'kernels', i, j))),
    convBias: model.convBias.map((v, i) => fn(v, 'convBias', 0, i)),
    dense: model.dense.map((r, i) => r.map((v, j) => fn(v, 'dense', i, j))),
    denseBias: model.denseBias.map((v, i) => fn(v, 'denseBias', 0, i)),
  }
}

export function valueAt(model: Parameters, group: keyof Parameters, row: number, col: number) {
  return group === 'kernels' || group === 'dense' ? model[group][row][col] : model[group][col]
}

export function forward(model: Parameters, input: number[]): Forward {
  if (input.length !== INPUT * INPUT || input.some(v => !Number.isFinite(v))) throw new Error('输入必须包含 256 个有效像素')
  const conv = model.kernels.map((kernel, f) => Array.from({ length: CONV * CONV }, (_, p) => {
    const row = Math.floor(p / CONV), col = p % CONV
    return kernel.reduce((sum, w, k) => sum + w * input[(row + Math.floor(k / 3)) * INPUT + col + k % 3], model.convBias[f])
  }))
  const activated = conv.map(map => map.map(v => Math.max(0, v)))
  const pooled = activated.flatMap(map => Array.from({ length: POOL * POOL }, (_, p) => {
    const base = Math.floor(p / POOL) * 2 * CONV + p % POOL * 2
    return (map[base] + map[base + 1] + map[base + CONV] + map[base + CONV + 1]) / 4
  }))
  const logits = model.dense.map((weights, c) => weights.reduce((sum, w, i) => sum + w * pooled[i], model.denseBias[c]))
  const max = Math.max(...logits)
  const exp = logits.map(v => Math.exp(v - max)), total = exp.reduce((a, b) => a + b, 0)
  return { conv, activated, pooled, logits, probabilities: exp.map(v => v / total) }
}

export function loss(result: Forward, label: number) {
  // Log-sum-exp keeps the loss and p-y gradient consistent even at extreme logits.
  const max = Math.max(...result.logits)
  return max + Math.log(result.logits.reduce((sum, v) => sum + Math.exp(v - max), 0)) - result.logits[label]
}

export function backward(model: Parameters, input: number[], label: number, result = forward(model, input)): Backward {
  const parameters = mapParameters(model, () => 0)
  const logits = result.probabilities.map((p, c) => p - Number(c === label))
  const pooled = zeros(FEATURES)
  logits.forEach((d, c) => {
    parameters.denseBias[c] = d
    pooled.forEach((_, i) => {
      parameters.dense[c][i] = d * result.pooled[i]
      pooled[i] += model.dense[c][i] * d
    })
  })
  const conv = Array.from({ length: FILTERS }, () => zeros(CONV * CONV))
  const inputGradient = zeros(INPUT * INPUT)
  pooled.forEach((d, i) => {
    const f = Math.floor(i / (POOL * POOL)), p = i % (POOL * POOL)
    const base = Math.floor(p / POOL) * 2 * CONV + p % POOL * 2
    for (const offset of [0, 1, CONV, CONV + 1]) {
      const at = base + offset
      conv[f][at] = result.conv[f][at] > 0 ? d / 4 : 0
    }
  })
  conv.forEach((map, f) => map.forEach((d, p) => {
    const row = Math.floor(p / CONV), col = p % CONV
    parameters.convBias[f] += d
    model.kernels[f].forEach((w, k) => {
      const at = (row + Math.floor(k / 3)) * INPUT + col + k % 3
      parameters.kernels[f][k] += d * input[at]
      inputGradient[at] += d * w
    })
  }))
  return { parameters, logits, pooled, conv, input: inputGradient }
}

export function applyGradient(model: Parameters, gradient: Parameters, rate: number) {
  return mapParameters(model, (v, group, row, col) => v - rate * valueAt(gradient, group, row, col))
}

export function evaluate(model: Parameters, samples: Sample[]) {
  if (!samples.length) return null
  let totalLoss = 0, correct = 0
  for (const sample of samples) {
    const result = forward(model, sample.pixels)
    totalLoss += loss(result, sample.label)
    correct += Number(argmax(result.probabilities) === sample.label)
  }
  return { loss: totalLoss / samples.length, accuracy: correct / samples.length * 100 }
}
