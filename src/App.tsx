import { useEffect, useState } from 'react'
import { ArrowRight, Database, Download, FileUp, FolderOpen, Layers3, Pause, Pencil, Play, RefreshCw, Rocket, Upload } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { argmax, forward, INPUT } from './cnn.ts'
import type { Forward, Sample } from './cnn.ts'
import { readImage } from './dataset.ts'
import { loadFolderDataset } from './folderDataset.ts'
import type { ImageInput } from './dataset.ts'
import { HandwritingPad } from './HandwritingPad.tsx'
import { Trainer } from './trainer.ts'
import { TrainingProcess } from './TrainingProcess.tsx'
import { fmt, PixelMap, Probabilities } from './Visuals.tsx'
import { loadStoredModels, modelFile, persistStoredModels, restoreModel } from './modelStorage.ts'
import type { ModelRecord } from './modelStorage.ts'

type Tab = '模型训练' | '模型体验'
type Status = 'idle' | 'running' | 'paused' | 'complete'
const statusLabel: Record<Status, string> = { idle: '尚未开始', running: '正在训练', paused: '已暂停', complete: '训练完成' }
export default function App() {
  const [tab, setTab] = useState<Tab>('模型训练')
  const [trainer, setTrainer] = useState(() => new Trainer([], []))
  const [models, setModels] = useState<ModelRecord[]>(loadStoredModels)
  const [activeModelId, setActiveModelId] = useState('')
  const [modelName, setModelName] = useState('')
  const [, setRevision] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [rate, setRate] = useState(.05)
  const [intervalMs, setIntervalMs] = useState(400)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'folder' | 'custom'>('folder')
  const [custom, setCustom] = useState<{ samples: Sample[]; labels: string[] }>({ samples: [], labels: [] })
  const [uploadLabel, setUploadLabel] = useState('')
  const [busy, setBusy] = useState(true)
  const [openingFolder, setOpeningFolder] = useState(false)
  const refresh = () => setRevision(v => v + 1)

  useEffect(() => {
    persistStoredModels(models)
  }, [models])

  useEffect(() => {
    const controller = new AbortController()
    loadFolderDataset(controller.signal).then(data => {
      if (!controller.signal.aborted) setTrainer(new Trainer(data.samples, data.labels))
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => {
      try {
        trainer.advance(rate)
        if (trainer.complete) {
          setStatus('complete')
          saveFinishedModel()
        }
        setRevision(v => v + 1)
      } catch (e) { setError(String(e)); setStatus('paused') }
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [trainer, status, rate, intervalMs])

  const replace = (samples: Sample[], labels: string[]) => {
    setTrainer(new Trainer(samples, labels)); setActiveModelId(''); setModelName(''); setStatus('idle'); setError(''); refresh()
  }
  const reset = () => { replace(trainer.samples, trainer.labels); setNotice('已创建新的训练草稿。请先为它命名，再开始训练；已有模型仍可在模型体验中使用。') }
  const registerModel = () => {
    const name = modelName.trim()
    if (!name) return false
    const existing = models.find(model => model.trainer === trainer)
    if (existing) { setActiveModelId(existing.id); return true }
    const record: ModelRecord = { id: crypto.randomUUID(), name, trainer, source: 'browser' }
    setModels(current => current.some(model => model.trainer === trainer) ? current : [...current, record])
    setActiveModelId(record.id)
    return true
  }
  const saveFinishedModel = () => {
    const savedAt = new Date().toISOString()
    setModels(current => {
      const next = current.map(record => record.trainer === trainer ? { ...record, savedAt } : record)
      return next.some((record, index) => record !== current[index]) ? next : current
    })
    setNotice('训练完成，模型已保存到当前浏览器。可从页面顶部导出模型文件。')
  }
  const resume = () => {
    if (!trainer.ready || busy || trainer.complete) return
    if (!trainer.steps && !modelName.trim()) {
      setError('请先填写模型名称，再开始这次训练。')
      return
    }
    try {
      if (!trainer.steps && !registerModel()) return
      if (!trainer.steps) trainer.advance(rate)
      if (trainer.complete) { setStatus('complete'); saveFinishedModel() } else { setStatus('running'); setNotice('') }
      refresh()
    } catch (e) { setError(String(e)); setStatus('paused') }
  }
  const reloadFolder = async () => {
    setBusy(true); setError('')
    try {
      const data = await loadFolderDataset()
      setMode('folder'); replace(data.samples, data.labels)
      setNotice(`已读取 ${data.samples.length} 张素材，模型已重置。`)
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const openFolder = async () => {
    setOpeningFolder(true); setError('')
    try {
      const response = await fetch('/__convlens/open-training-folder', {
        method: 'POST', headers: { 'X-ConvLens-Action': 'open-training-folder' },
        signal: AbortSignal.timeout(12000),
      })
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null
      if (!response.ok || result?.opened !== true) {
        throw new Error(result?.error || '无法直接打开文件夹，请使用本机启动的网站访问。')
      }
    } catch (e) {
      setError(e instanceof Error && e.name === 'Error' ? e.message : '打开文件夹失败，请确认本机网站服务正在运行后重试。')
    } finally { setOpeningFolder(false) }
  }
  const changeMode = (next: 'folder' | 'custom') => {
    if (next === 'folder') { void reloadFolder(); return }
    setMode('custom'); setUploadLabel(''); replace(custom.samples, custom.labels)
    setNotice('已切换数据集，模型重新初始化。')
  }
  const upload = async (files: File[]) => {
    const labelName = uploadLabel.trim()
    if (!labelName) { setError('先填写这些图片的正确标签，再添加图片。'); return }
    if (!files.length) return
    if (files.length > 60) { setError('每次最多添加 60 张图片。'); return }
    setBusy(true); setError(''); setStatus('paused')
    try {
      const results = await Promise.allSettled(files.map(readImage))
      const loaded = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
      const failures = results.flatMap(r => r.status === 'rejected' ? [String(r.reason)] : [])
      if (loaded.length) {
        const labels = [...trainer.labels]
        if (!labels.includes(labelName)) labels.push(labelName)
        const label = labels.indexOf(labelName), count = trainer.samples.filter(s => s.label === label).length
        const additions: Sample[] = loaded.map((item, i) => ({ ...item, id: crypto.randomUUID(), label, split: (count + i + 1) % 5 === 0 ? 'validation' : 'train' }))
        const data = { samples: [...trainer.samples, ...additions], labels }
        if (mode === 'custom') setCustom(data)
        replace(data.samples, data.labels)
        setNotice(`已添加 ${loaded.length} 张「${labelName}」图片并重置模型。每类每 5 张留 1 张用于验证。`)
      }
      if (failures.length) setError(failures.join('；'))
    } finally { setBusy(false) }
  }
  const importModel = async (file: File) => {
    setError('')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const restored = restoreModel(parsed, 'file')
      if (!restored) throw new Error('模型文件格式无效，或与当前 ConvLens 版本不兼容。')
      const record: ModelRecord = { ...restored, id: crypto.randomUUID(), name: restored.name || file.name.replace(/\.json$/i, '') }
      setModels(current => [...current, record])
      setActiveModelId(record.id)
      setNotice(`已导入模型「${record.name}」，可在模型体验中选择。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '模型文件读取失败。')
    }
  }
  const exportModel = (record: ModelRecord) => {
    const blob = new Blob([modelFile(record)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${record.name.replace(/[\\/:*?"<>|]/g, '_') || 'convlens-model'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const locked = busy || status === 'running'
  const metric = trainer.metrics[trainer.metrics.length - 1]
  const completedModel = models.find(model => model.trainer === trainer)
  return <div className="app-shell" data-model-step={trainer.steps} data-status={status}>
    <header className="topbar"><div className="topbar-inner">
      <div className="brand"><span className="brand-mark"><Layers3 size={19}/></span><span>Conv<span>Lens</span></span></div>
      <nav className="top-nav" aria-label="实验室导航">{(['模型训练', '模型体验'] as Tab[]).map(item => <button key={item} className={tab === item ? 'active' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}><span>{item}</span></button>)}</nav>
      <div className="runtime"><i/> 浏览器本地训练</div>
    </div></header>
    <main>
      <div className="session-bar"><span className={`session-status ${busy ? 'loading' : status}`}>{busy ? '正在读取素材…' : statusLabel[status]}</span><span>{modelName ? `模型：${modelName}` : '当前训练尚未命名'} · 已完成 {trainer.epoch} / {trainer.maxEpochs} 轮 · 已更新 <b>{trainer.steps}</b> 次</span>{status === 'complete' && completedModel && <button className="outline-btn export-model-btn" onClick={() => exportModel(completedModel)}><Download size={14}/>导出模型</button>}<label className="speed-control">训练速度<select aria-label="训练速度" value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))}><option value={200}>2× · 0.2 秒/批</option><option value={400}>正常 · 0.4 秒/批</option><option value={1000}>慢速 · 1 秒/批</option><option value={2000}>慢速 · 2 秒/批</option><option value={5000}>慢速 · 5 秒/批</option><option value={10000}>慢速 · 10 秒/批</option></select></label>{(status === 'running' || status === 'paused') && <button onClick={status === 'running' ? () => setStatus('paused') : resume} disabled={busy}>{status === 'running' ? <Pause size={14}/> : <Play size={14}/>} {status === 'running' ? '暂停训练' : '继续训练'}</button>}</div>
      {error && <div role="alert" className="message error">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
      {notice && <div role="status" className="message">{notice}<button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

      {tab === '模型训练' && <div className="page">
        <section className="page-heading"><h1>模型训练</h1><div className="page-actions"><button className="primary-btn" disabled={!trainer.ready || busy || trainer.complete} onClick={status === 'running' ? () => setStatus('paused') : resume}>{status === 'running' ? <Pause size={16}/> : <Play size={16}/>} {status === 'running' ? '暂停训练' : trainer.steps ? '继续训练' : '开始训练'}</button><button className="outline-btn" disabled={busy} onClick={reset}><RefreshCw size={16}/>重置训练</button></div></section>
        <div className="workspace">
          <aside className="data-panel panel">
            <h2><Database size={17}/>训练数据</h2>
            <label className="field">数据来源<select aria-label="数据来源" value={mode} disabled={locked} onChange={e => changeMode(e.target.value as typeof mode)}><option value="folder">素材文件夹</option><option value="custom">临时上传图片</option></select></label>
            <p className="caption">{mode === 'folder' ? 'public/training-data/，子文件夹名为类别标签。' : '至少两个类别，每类建议 10 张以上。刷新后不保留。'}</p>
            {mode === 'folder' && <div className="dataset-actions"><button className="outline-btn" disabled={openingFolder} onClick={() => void openFolder()}><FolderOpen size={14}/>{openingFolder ? '正在打开…' : '打开素材文件夹'}</button><button className="outline-btn" disabled={locked} onClick={() => void reloadFolder()}><RefreshCw size={14}/>重新读取</button></div>}
            <div className="dataset-counts"><span>训练 <b>{trainer.train.length}</b></span><span>验证 <b>{trainer.validation.length}</b></span><span>类别 <b>{trainer.labels.length}</b></span></div>
            <div className="class-counts">{trainer.labels.map((name, i) => <span key={name}>{name}<b>{trainer.samples.filter(s => s.label === i).length} 张</b></span>)}</div>
            {mode === 'custom' && <><label className="field">上传图片的正确标签<input aria-label="上传标签" disabled={locked} value={uploadLabel} maxLength={24} placeholder="例如：猫" onChange={e => setUploadLabel(e.target.value)}/></label>
            <label className={`upload-button ${locked ? 'disabled' : ''}`}><Upload size={17}/>{busy ? '正在读取图片…' : '添加已标注图片'}<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={locked} aria-label="添加训练图片" onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }}/></label></>}
            <label className="field">模型名称<input aria-label="模型名称" maxLength={40} disabled={locked || Boolean(trainer.steps)} value={modelName} placeholder="例如：数字识别 v1" onChange={e => setModelName(e.target.value)}/></label>
            <p className="caption">每次开始新的训练前先命名。训练开始后名称锁定，完成的模型可以在「模型体验」中切换。</p>
            <p className="caption">训练与预测均转换为 16×16 灰度，保持比例并填充黑边。数字建议白字黑底。修改数据会重新初始化模型。</p>
            <label className="field">学习率<select aria-label="学习率" disabled={locked} value={rate} onChange={e => setRate(Number(e.target.value))}><option value={.01}>0.01 · 小步调整</option><option value={.05}>0.05 · 推荐</option><option value={.1}>0.1 · 较大步调整</option></select></label>
            <p className="caption">每批 {trainer.batchSize} 张 · SGD</p>
          </aside>
          <div className="training-main">
            <TrainingProcess snapshot={trainer.latest} labels={trainer.labels} running={status === 'running'} intervalMs={intervalMs} ready={trainer.ready}/>
            <section className="panel metrics-panel"><div className="section-title"><h2>训练指标</h2><span className="caption">每完成一轮计算一次</span></div><div className="metric-row"><div><small>训练准确率</small><b>{metric ? `${fmt(metric.accuracy, 1)}%` : '—'}</b></div><div><small>验证准确率</small><b>{metric?.val != null ? `${fmt(metric.val, 1)}%` : '—'}</b></div><div><small>训练损失</small><b>{metric ? fmt(metric.loss) : '—'}</b></div></div>{trainer.metrics.length ? <div className="chart"><ResponsiveContainer width="100%" height={200}><LineChart data={trainer.metrics}><CartesianGrid stroke="#e5e7eb" vertical={false}/><XAxis dataKey="epoch"/><YAxis domain={[0, 100]} width={35}/><Tooltip/><Line dataKey="accuracy" name="训练准确率 %" stroke="#2563eb" dot={false}/><Line dataKey="val" name="验证准确率 %" stroke="#0f766e" dot={false}/></LineChart></ResponsiveContainer></div> : <p className="empty-note">第一轮完成后显示曲线。</p>}<p className="caption">验证图片不参与梯度更新。{!trainer.validation.length && '当前还没有验证图片，因此不显示验证准确率。'}训练进度仅保留在当前页面，刷新会重置。</p></section>
          </div>
        </div>
      </div>}

      {tab === '模型体验' && <Inference trainer={trainer} models={models} activeModelId={activeModelId} onImportModel={importModel}/>}
    </main>
  </div>
}

function Inference({ trainer, models, activeModelId, onImportModel }: { trainer: Trainer; models: ModelRecord[]; activeModelId: string; onImportModel: (file: File) => Promise<void> }) {
  const [inputMode, setInputMode] = useState<'drawing' | 'image'>('drawing')
  const [drawing, setDrawing] = useState<ImageInput | null>(null)
  const [image, setImage] = useState<ImageInput | null>(null)
  const [result, setResult] = useState<{ forward: Forward; step: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedModelId, setSelectedModelId] = useState(activeModelId)
  useEffect(() => {
    if (!selectedModelId || !models.some(model => model.id === selectedModelId)) setSelectedModelId(activeModelId)
  }, [activeModelId, models, selectedModelId])
  const selectedModel = models.find(model => model.id === selectedModelId)
  const selectedTrainer = selectedModel?.trainer ?? trainer
  const input = inputMode === 'drawing' ? drawing : image
  const choose = async (file: File) => {
    setBusy(true); setError(''); setResult(null)
    try { setImage(await readImage(file)) } catch (e) { setError(String(e)); setImage(null) }
    finally { setBusy(false) }
  }
  const switchInput = (mode: typeof inputMode) => {
    setInputMode(mode); setResult(null); setError('')
  }
  const predict = () => {
    if (input && selectedTrainer.ready) setResult({ forward: forward(selectedTrainer.model, input.pixels), step: selectedTrainer.steps })
  }
  const examples = selectedTrainer.validation.length ? selectedTrainer.validation : selectedTrainer.train
  return <div className="page">
    <section className="page-heading"><div><h1>模型体验</h1><p>类别：{selectedTrainer.labels.join('、') || '暂无'} · {selectedModel ? `当前模型：${selectedModel.name}` : '当前是未命名训练草稿'}</p></div><div className="model-tools"><label className="model-picker">选择模型<select aria-label="选择模型" value={selectedModelId} onChange={e => { setSelectedModelId(e.target.value); setImage(null); setResult(null); setError('') }}>{!activeModelId && <option value="">当前训练草稿</option>}{models.map(model => <option value={model.id} key={model.id}>{model.name} · 本地模型 · {model.trainer.steps} 次更新</option>)}</select></label><div className="model-file-actions"><label className="outline-btn file-button"><FileUp size={14}/>导入模型<input type="file" accept="application/json,.json" aria-label="导入模型文件" onChange={e => { const file = e.target.files?.[0]; if (file) void onImportModel(file); e.target.value = '' }}/></label></div></div></section>
    <div className="inference-grid">
      <section className="panel inference-input">
        <div className="input-switch" role="group" aria-label="识别输入方式">
          <button aria-pressed={inputMode === 'drawing'} className={inputMode === 'drawing' ? 'active' : ''} onClick={() => switchInput('drawing')}><Pencil size={16}/>手写输入</button>
          <button aria-pressed={inputMode === 'image'} className={inputMode === 'image' ? 'active' : ''} onClick={() => switchInput('image')}><Upload size={16}/>图片输入</button>
        </div>
        <div hidden={inputMode !== 'drawing'}>
          <HandwritingPad onChange={value => { setDrawing(value); setResult(null) }}/>
        </div>
        <div hidden={inputMode !== 'image'}>
          {error && <div role="alert" className="message error">{error}</div>}
          <label className="upload-button"><Upload size={18}/>{busy ? '正在读取…' : '选择测试图片'}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择测试图片" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void choose(file); e.target.value = '' }}/></label>
          <p className="caption">{selectedTrainer.validation.length ? '验证样本' : '训练集样本（非独立验证）'}</p>
          <div className="sample-strip">{selectedTrainer.labels.flatMap((_, i) => examples.filter(s => s.label === i).slice(0, 2)).slice(0, 8).map(s => <button key={s.id} disabled={busy} aria-label={`测试 ${s.name}`} onClick={() => { setImage(s); setResult(null); setError('') }}><PixelMap values={s.pixels} width={INPUT} gray label={s.name}/><span>{selectedTrainer.labels[s.label]}</span></button>)}</div>
          {image && <figure className="inference-image">{image.original ? <img className="original-image" src={image.original} alt={image.name}/> : <PixelMap values={image.pixels} width={INPUT} gray label="测试图片"/>}<figcaption>{image.name}</figcaption></figure>}
        </div>
        <button className="primary-btn full" disabled={!input || (inputMode === 'image' && busy) || !selectedTrainer.ready} onClick={predict}>开始识别 <ArrowRight size={16}/></button>
        {!selectedTrainer.ready && <p className="caption">至少准备两个类别的训练数据后才能识别。</p>}
      </section>
      <section className="panel inference-output">
        <h2>识别结果</h2>
        {!selectedTrainer.steps && <div className="freeze-banner">模型尚未训练，当前使用初始化参数。</div>}
        {input ? <>
          <div className="model-input-preview"><PixelMap values={input.pixels} width={INPUT} gray label="识别图片的模型输入"/><div><h3>模型输入</h3><p>16×16 灰度</p><span>{input.name}</span></div></div>
          {result ? <>
            <div className="prediction-result"><span>模型判断</span><strong>{selectedTrainer.labels[argmax(result.forward.probabilities)]}</strong><small>参数版本 #{result.step}</small></div>
            <Probabilities labels={selectedTrainer.labels} values={result.forward.probabilities}/>
            <h3>卷积特征</h3>
            <div className="inference-features">{result.forward.activated.map((map, i) => <figure key={i}><PixelMap values={map} width={14} label={`预测特征图 ${i + 1}`}/><figcaption>卷积核 {i + 1}</figcaption></figure>)}</div>
            {result.step !== selectedTrainer.steps && <p className="caption">模型已更新到第 {selectedTrainer.steps} 次，点击识别可重新计算。</p>}
            <p className="caption">特征图是卷积层响应，并非注意力图。识别效果取决于训练数据与输入的相似程度。</p>
          </> : <p className="recognition-pending">输入已更新，点击「开始识别」。</p>}
        </> : <div className="empty-state">{inputMode === 'drawing' ? <Pencil size={32}/> : <Rocket size={36}/>}<h3>{inputMode === 'drawing' ? '等待手写输入' : '等待测试图片'}</h3></div>}
      </section>
    </div>
  </div>
}
