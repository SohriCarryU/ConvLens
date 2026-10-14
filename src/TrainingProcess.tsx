import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Grid3X3, RefreshCw, StepForward } from 'lucide-react'
import { argmax, CONV, FILTERS, INPUT, POOL } from './cnn.ts'
import type { Snapshot, Trace } from './trainer.ts'
import { fmt, pct, PixelMap, Probabilities, Weights } from './Visuals.tsx'

const stages = [
  ['input', '输入图片'],
  ['convolution', '卷积扫描'],
  ['activation', '激活与池化'],
  ['prediction', '分类预测'],
  ['loss', '标签与损失'],
  ['backward', '反向传播'],
  ['update', '更新与反馈'],
]

function Stage({ index, step, children, className = '' }: { index: number; step: number; children: ReactNode; className?: string }) {
  const [id, title] = stages[index]
  return <section id={`training-${id}`} className={`panel process-stage ${className}`} data-trace-step={step} aria-labelledby={`heading-${id}`}>
    <div className="stage-heading"><h3 id={`heading-${id}`}><span>{index + 1}</span>{title}</h3><small>#{step}</small></div>
    {children}
  </section>
}

export function TrainingProcess({ snapshot, labels, running, intervalMs, ready }: {
  snapshot: Snapshot | null; labels: string[]; running: boolean; intervalMs: number; ready: boolean;
}) {
  if (!snapshot) return <section className="panel process-empty">
    <h2>训练过程</h2>
    <div className="process-route">{stages.map(([id, title], i) => <span key={id}>{i + 1} {title}{i < stages.length - 1 && <ArrowRight size={12}/>}</span>)}</div>
    <Grid3X3 size={36}/>
    <p>{!ready ? '至少添加两个类别的训练图片。' : running ? '正在计算第一批…' : '开始训练后显示各阶段的计算结果。'}</p>
  </section>
  return <LiveProcess snapshot={snapshot} labels={labels} running={running} intervalMs={intervalMs}/>
}

function LiveProcess({ snapshot, labels, running, intervalMs }: {
  snapshot: Snapshot; labels: string[]; running: boolean; intervalMs: number;
}) {
  const [sampleIndex, setSampleIndex] = useState(0)
  const [filter, setFilter] = useState(0)
  const [weight, setWeight] = useState(4)
  // A final partial batch can contain fewer samples than the previous batch.
  const selectedSample = Math.min(sampleIndex, snapshot.traces.length - 1)
  const trace = snapshot.traces[selectedSample]
  const target = trace.sample.label
  const prediction = labels[argmax(trace.forward.probabilities)]
  const kernel = snapshot.before.kernels[filter]
  const selectedRow = Math.floor(weight / 3), selectedCol = weight % 3
  const contributions = trace.backward.conv[filter].map((d, p) => d * trace.sample.pixels[(Math.floor(p / CONV) + selectedRow) * INPUT + p % CONV + selectedCol])

  return <div className="training-process" data-trace-step={snapshot.step} data-sample-id={trace.sample.id}>
    <section className="panel process-controls">
      <div className="section-title"><div><h2>训练过程</h2><p className="caption">第 {snapshot.epoch} 轮 · 第 {snapshot.batch} 批 · 已更新 #{snapshot.step} · {snapshot.traces.length} 张图片</p></div><span className={`live-badge ${running ? 'running' : ''}`}><i/>{running ? '实时更新' : '最近一批'}</span></div>
      <div className="process-selectors">
        <label>批次样本<select aria-label="当前批次样本" value={selectedSample} onChange={e => setSampleIndex(Number(e.target.value))}>{snapshot.traces.map((t, i) => <option value={i} key={i}>{i + 1}. {t.sample.name} / 标签 {labels[t.sample.label]}</option>)}</select></label>
        <label>计算明细<select aria-label="卷积核" value={filter} onChange={e => setFilter(Number(e.target.value))}>{Array.from({ length: FILTERS }, (_, i) => <option value={i} key={i}>卷积核 {i + 1}</option>)}</select></label>
      </div>
      <nav className="process-route" aria-label="训练过程定位">{stages.map(([id, title], i) => <a key={id} href={`#training-${id}`}><span>{i + 1}</span>{title}{i < stages.length - 1 && <ArrowRight size={12}/>}</a>)}</nav>
    </section>

    <Stage index={0} step={snapshot.step}>
      <div className="input-process">
        <figure>{trace.sample.original ? <img className="original-image" src={trace.sample.original} alt={trace.sample.name}/> : <PixelMap values={trace.sample.pixels} width={INPUT} gray label="当前训练样本"/>}<figcaption>{trace.sample.name}</figcaption></figure>
        <ArrowRight className="between-arrow"/>
        <figure><PixelMap values={trace.sample.pixels} width={INPUT} gray label="归一化模型输入"/><figcaption>16×16 灰度 · 像素值 0～1</figcaption></figure>
        <div className="batch-samples"><span className="label-badge">真实标签：{labels[target]}</span><div className="sample-strip">{snapshot.traces.map((t, i) => <button key={i} onClick={() => setSampleIndex(i)} className={i === selectedSample ? 'selected' : ''} aria-label={`查看批次样本 ${i + 1}`}><PixelMap values={t.sample.pixels} width={INPUT} gray label={t.sample.name}/><span>{labels[t.sample.label]}</span></button>)}</div><p className="caption">标签用于计算误差，不作为图片特征输入。</p></div>
      </div>
    </Stage>

    <Stage index={1} step={snapshot.step}>
      <ConvolutionScan snapshot={snapshot} trace={trace} filter={filter} running={running} intervalMs={intervalMs} weight={weight} onSelect={(f, w) => { setFilter(f); setWeight(w) }}/>
    </Stage>

    <Stage index={2} step={snapshot.step}>
      <div className="activation-grid">{trace.forward.conv.map((map, f) => <div className={`activation-column ${filter === f ? 'selected' : ''}`} key={f}>
        <h4>卷积核 {f + 1}</h4>
        <figure><PixelMap values={map} width={CONV} signed label={`卷积核${f + 1}原始响应`}/><figcaption>卷积响应 14×14</figcaption></figure>
        <span className="flow-down">↓ ReLU</span>
        <figure><PixelMap values={trace.forward.activated[f]} width={CONV} label={`卷积核${f + 1}ReLU响应`}/><figcaption>负响应置 0</figcaption></figure>
        <span className="flow-down">↓ 2×2 平均池化</span>
        <figure><PixelMap values={trace.forward.pooled.slice(f * POOL * POOL, (f + 1) * POOL * POOL)} width={POOL} label={`卷积核${f + 1}池化响应`}/><figcaption>池化结果 7×7</figcaption></figure>
      </div>)}</div>
      <div className="formula">4 × 7 × 7 = 196 个特征 → 展平 → 分类层</div>
    </Stage>

    <div className="prediction-loss-grid">
      <Stage index={3} step={snapshot.step}>
        <h4>预测：{prediction}</h4>
        <Probabilities labels={labels} values={trace.forward.probabilities} target={target}/>
        <div className="score-list">{labels.map((label, i) => <span key={label}>{label} 得分 <b>{fmt(trace.forward.logits[i])}</b></span>)}</div>
        <div className="formula">得分 = Σ（池化特征 × 分类权重）+ 偏置<br/>Softmax → 类别概率</div>
      </Stage>
      <Stage index={4} step={snapshot.step}>
        <span className="label-badge">真实标签：{labels[target]} · {prediction === labels[target] ? '预测正确' : '预测错误'}</span>
        <div className="loss-explainer"><small>该样本的交叉熵损失</small><strong data-testid="sample-loss">{fmt(trace.loss)}</strong><code>−ln(P(正确类别)) = −ln({fmt(trace.forward.probabilities[target])})</code><p>本批平均损失：<b>{fmt(snapshot.loss)}</b></p></div>
        <p className="caption">正确类别的概率越低，损失越大。</p>
      </Stage>
    </div>

    <Stage index={5} step={snapshot.step}>
      <div className="backward-path"><b>损失 L</b><ArrowRight/><span>得分梯度 p − y</span><ArrowRight/><span>分类权重 Wᵀ</span><ArrowRight/><span>池化 ÷ 4</span><ArrowRight/><b>ReLU → 卷积核</b></div>
      <div className="gradient-labels">{labels.map((label, i) => <div key={label}><b>类别 {label}</b><code>{fmt(trace.forward.probabilities[i])} − {Number(i === target)} = {fmt(trace.backward.logits[i])}</code><small>{i === target ? '推动得分上升' : '推动得分下降'}</small></div>)}</div>
      <div className="all-kernel-gradients">{trace.backward.parameters.kernels.map((gradient, f) => <section className={`kernel-gradient-card ${filter === f ? 'selected' : ''}`} key={f} data-kernel={f + 1}>
        <h4>卷积核 {f + 1}</h4><div className="gradient-maps">
          <figure><PixelMap values={trace.backward.pooled.slice(f * POOL * POOL, (f + 1) * POOL * POOL)} width={POOL} signed label={`卷积核 ${f + 1} 池化输出梯度`}/><figcaption>池化特征梯度</figcaption></figure>
          <figure><PixelMap values={trace.backward.conv[f]} width={CONV} signed label={`卷积核 ${f + 1} 卷积响应梯度`}/><figcaption>ReLU 回传梯度</figcaption></figure>
          <div><h4>核权重梯度</h4><Weights values={gradient} selected={filter === f ? weight : undefined} onSelect={w => { setFilter(f); setWeight(w) }}/></div>
        </div>
      </section>)}</div>
      <p className="caption">绿色为正梯度，橙色为负梯度，颜色按每张图缩放。梯度下降中，正梯度使参数减小，负梯度使参数增大。</p>
      <div className="gradient-detail"><figure><PixelMap values={contributions} width={CONV} signed label="每个扫描位置对选中权重的梯度贡献"/><figcaption>196 个窗口的梯度贡献</figcaption></figure><div><h4>卷积核 {filter + 1} · 权重 [{selectedRow + 1}, {selectedCol + 1}] 的梯度汇总</h4><code>∂L/∂w = Σ（响应梯度 × 输入像素）<br/>= {fmt(trace.backward.parameters.kernels[filter][weight], 6)}</code><p className="caption">先汇总同一图片的全部窗口，再对本批 {snapshot.traces.length} 张图片取平均。</p></div></div>
    </Stage>

    <Stage index={6} step={snapshot.step}>
      <div className="update-meta"><span>{FILTERS} 个卷积核 · 全部权重</span><span>学习率 {snapshot.rate} · 已应用</span></div>
      <div className="all-kernel-updates">{snapshot.before.kernels.map((before, f) => <section key={f} className={`kernel-update-card ${filter === f ? 'selected' : ''}`} data-kernel={f + 1}>
        <h4>卷积核 {f + 1}</h4><div className="weight-comparison">
          <div><h4>更新前权重</h4><Weights values={before} selected={filter === f ? weight : undefined} onSelect={w => { setFilter(f); setWeight(w) }}/></div>
          <div><h4>全批平均梯度</h4><Weights values={snapshot.gradient.kernels[f]} selected={filter === f ? weight : undefined} onSelect={w => { setFilter(f); setWeight(w) }}/></div>
          <div><h4>更新后权重</h4><Weights values={snapshot.after.kernels[f]} selected={filter === f ? weight : undefined} onSelect={w => { setFilter(f); setWeight(w) }}/></div>
          <div className="weight-delta"><h4>变化量 Δw</h4><Weights values={before.map((v, i) => snapshot.after.kernels[f][i] - v)} digits={6} selected={filter === f ? weight : undefined} onSelect={w => { setFilter(f); setWeight(w) }}/></div>
        </div><p className="caption">偏置：{fmt(snapshot.before.convBias[f], 6)} → {fmt(snapshot.after.convBias[f], 6)} · Δb = {fmt(snapshot.after.convBias[f] - snapshot.before.convBias[f], 6)}</p>
      </section>)}</div>
      <div className="formula" data-testid="weight-update">卷积核 {filter + 1} · 权重 [{selectedRow + 1}, {selectedCol + 1}]<br/>新权重 = 旧权重 − 学习率 × 平均梯度<br/>{fmt(kernel[weight], 6)} − {snapshot.rate} × ({fmt(snapshot.gradient.kernels[filter][weight], 6)}) = <b>{fmt(snapshot.after.kernels[filter][weight], 6)}</b></div>
      <h4>样本梯度贡献（{snapshot.traces.length} 张）</h4>
      <div className="table-scroll"><table><thead><tr><th>图片</th><th>标签</th><th>选中权重的梯度</th><th>更新前损失</th></tr></thead><tbody>{snapshot.traces.map((t, i) => <tr key={i} className={i === selectedSample ? 'selected' : ''}><td>{t.sample.name}</td><td>{labels[t.sample.label]}</td><td>{fmt(t.backward.parameters.kernels[filter][weight], 6)}</td><td>{fmt(t.loss)}</td></tr>)}</tbody></table></div>
      <div className="update-feedback"><div><h4>同一图片更新前后预测</h4><Probabilities labels={labels} values={trace.after.probabilities} previous={trace.forward.probabilities} target={target}/></div><div className="update-results">
        <p>正确类别概率<br/>{pct(trace.forward.probabilities[target])} → <b>{pct(trace.after.probabilities[target])}</b></p>
        <p>样本损失<br/>{fmt(trace.loss)} → <b>{fmt(trace.lossAfter)}</b></p>
        <p>全批平均损失<br/>{fmt(snapshot.loss)} → <b>{fmt(snapshot.lossAfter)}</b></p>
      </div></div>
      <p className="caption">分类层权重和各层偏置同步更新。批次更新不保证每张图片或验证集的结果都改善。</p>
    </Stage>
  </div>
}

function ConvolutionScan({ snapshot, trace, filter, running, intervalMs, weight, onSelect }: {
  snapshot: Snapshot; trace: Trace; filter: number; running: boolean; intervalMs: number; weight: number; onSelect: (filter: number, weight: number) => void;
}) {
  const [position, setPosition] = useState(0)
  const [autoScan, setAutoScan] = useState(true)
  useEffect(() => {
    if (!autoScan || !running) return
    setPosition(0)
    const started = performance.now()
    const timer = window.setInterval(() => {
      setPosition(Math.min(CONV * CONV - 1, Math.floor((performance.now() - started) / intervalMs * CONV * CONV)))
    }, 40)
    return () => window.clearInterval(timer)
  }, [snapshot, autoScan, running, intervalMs])
  const selectPosition = (p: number) => { setAutoScan(false); setPosition(Math.max(0, Math.min(CONV * CONV - 1, p))) }
  const select = (r: number, c: number) => selectPosition(Math.min(CONV - 1, Math.max(0, r)) * CONV + Math.min(CONV - 1, Math.max(0, c)))
  const row = Math.floor(position / CONV), col = position % CONV
  const kernel = snapshot.before.kernels[filter]
  const pixels = kernel.map((_, i) => trace.sample.pixels[(row + Math.floor(i / 3)) * INPUT + col + i % 3])
  return <>
    <div className="scan-toolbar"><label><input type="checkbox" checked={autoScan} onChange={e => setAutoScan(e.target.checked)}/>自动扫描</label><button className="outline-btn" disabled={position === CONV * CONV - 1} onClick={() => selectPosition(position + 1)}><StepForward size={15}/>移动一格</button><button className="ghost-btn" onClick={() => selectPosition(0)}><RefreshCw size={15}/>回到起点</button></div>
    <figure className="scan-input"><PixelMap values={trace.sample.pixels} width={INPUT} gray label="点击训练图片选择卷积窗口" window={{ row, col, size: 3 }} onSelect={select}/><figcaption>输入图片 · 窗口 ({row + 1}, {col + 1}) · 位置 {position + 1} / 196</figcaption></figure>
    <div className="all-kernel-responses">{snapshot.before.kernels.map((values, f) => <section key={f} className={`kernel-response-card ${filter === f ? 'selected' : ''}`} data-kernel={f + 1}>
      <h4>卷积核 {f + 1}</h4><Weights values={values} selected={filter === f ? weight : undefined} onSelect={w => onSelect(f, w)}/><p className="caption">偏置 b = {fmt(snapshot.before.convBias[f])}</p><figure><PixelMap values={trace.forward.conv[f]} width={CONV} signed label={`卷积核 ${f + 1} 当前批次卷积响应`} window={{ row, col, size: 1 }}/><figcaption>14×14 响应 · {fmt(trace.forward.conv[f][position])}</figcaption></figure>
    </section>)}</div>
    <input className="scan-range" type="range" min={0} max={CONV * CONV - 1} value={position} aria-label="卷积扫描位置" onChange={e => selectPosition(Number(e.target.value))}/>
    <div className="calculation-strip"><div><h4>3×3 图像窗口</h4><PixelMap values={pixels} width={3} gray label="当前卷积窗口放大"/></div><div><h4>卷积核 {filter + 1} · 像素 × 权重</h4><div className="products-grid">{pixels.map((pixel, i) => <span key={i} className={i === weight ? 'selected' : ''}>{fmt(pixel, 2)} × {fmt(kernel[i], 3)}<b>{fmt(pixel * kernel[i])}</b></span>)}</div></div><div className="output-value"><small>乘积之和 + 偏置</small><strong>{fmt(trace.forward.conv[filter][position])}</strong><span>ReLU：{fmt(trace.forward.activated[filter][position])}</span></div></div>
    <p className="caption">扫描回放当前批次的卷积计算，不影响训练。绿色为正响应，橙色为负响应，显示强度按图缩放。</p>
  </>
}
