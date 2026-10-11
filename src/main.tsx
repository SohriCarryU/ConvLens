import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowRight, BrainCircuit, Check, ChevronDown, CircleHelp,
  Cpu, Database, Download, Eye, FileUp, Gauge, Grid3X3, Image,
  Layers3, Lightbulb, MoreHorizontal, Pause, Play, Plus, RefreshCw,
  Rocket, Settings2, Sparkles, Upload, X
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './styles.css'

type Tab = '实验台' | '卷积透镜' | '模型体验'
type Metric = { epoch: number; accuracy: number; loss: number; val: number }

const initialMetrics: Metric[] = [
  { epoch: 1, accuracy: 42.1, loss: 1.54, val: 39.4 },
  { epoch: 2, accuracy: 58.9, loss: 1.12, val: 54.2 },
  { epoch: 3, accuracy: 68.2, loss: .83, val: 63.1 },
  { epoch: 4, accuracy: 74.6, loss: .62, val: 69.7 },
  { epoch: 5, accuracy: 80.4, loss: .47, val: 75.8 },
  { epoch: 6, accuracy: 84.3, loss: .38, val: 79.4 },
  { epoch: 7, accuracy: 87.6, loss: .31, val: 82.6 },
  { epoch: 8, accuracy: 89.2, loss: .27, val: 84.7 },
]

const kernels = {
  '边缘检测': [[-1,-1,-1],[-1,8,-1],[-1,-1,-1]],
  '锐化': [[0,-1,0],[-1,5,-1],[0,-1,0]],
  '模糊': [[1,1,1],[1,1,1],[1,1,1]],
}

const matrix = [[33, 52, 49, 41, 28], [45, 68, 81, 70, 39], [38, 71, 96, 85, 47], [24, 45, 65, 59, 35], [17, 28, 43, 47, 31]]

function App() {
  const [tab, setTab] = useState<Tab>('实验台')
  const [running, setRunning] = useState(false)
  const [epoch, setEpoch] = useState(8)
  const [metrics, setMetrics] = useState(initialMetrics)
  const [files, setFiles] = useState<File[]>([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setEpoch(current => {
        if (current >= 30) { setRunning(false); return current }
        const next = current + 1
        setMetrics(list => [...list, { epoch: next, accuracy: Math.min(98.8, 89.2 + (next - 8) * .43 + Math.random() * .6), loss: Math.max(.055, .27 - (next - 8) * .010 + Math.random() * .01), val: Math.min(97.1, 84.7 + (next - 8) * .44 + Math.random() * .7) }])
        return next
      })
    }, 650)
    return () => window.clearInterval(timer)
  }, [running])

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2500) }
  const onFiles = (picked: FileList | null) => {
    if (!picked?.length) return
    const imgs = Array.from(picked).filter(file => file.type.startsWith('image/'))
    setFiles(existing => [...existing, ...imgs])
    notify(`已添加 ${imgs.length} 张图像到待标注数据集`)
  }
  const restart = () => { setRunning(false); setEpoch(0); setMetrics([]); notify('已重置训练进度，可重新开始实验') }

  return <main>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Layers3 size={20}/></div><span>Conv<span>Lens</span></span><i>教学实验室</i></div>
      <nav>{(['实验台','卷积透镜','模型体验'] as Tab[]).map(item => <button key={item} onClick={() => setTab(item)} className={tab === item ? 'active' : ''}>{item === '实验台' && <Gauge size={16}/>} {item === '卷积透镜' && <Grid3X3 size={16}/>} {item === '模型体验' && <Rocket size={16}/>} {item}</button>)}</nav>
      <div className="top-actions"><button className="icon-button" title="帮助"><CircleHelp size={19}/></button><div className="avatar">林</div></div>
    </header>
    {tab === '实验台' && <Lab epoch={epoch} running={running} metrics={metrics} files={files} onFiles={onFiles} onStart={() => {setRunning(true); if(epoch === 0) notify('训练已开始：正在让模型学习图像特征')}} onPause={() => setRunning(false)} onRestart={restart} notify={notify}/>}
    {tab === '卷积透镜' && <Convolution />}
    {tab === '模型体验' && <Inference files={files} notify={notify}/>}
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </main>
}

function Lab({epoch, running, metrics, files, onFiles, onStart, onPause, onRestart, notify}: {epoch:number; running:boolean; metrics:Metric[]; files:File[]; onFiles:(f:FileList|null)=>void; onStart:()=>void; onPause:()=>void; onRestart:()=>void; notify:(s:string)=>void}) {
  const input = useRef<HTMLInputElement>(null)
  const latest = metrics[metrics.length - 1]
  return <div className="page lab-page">
    <section className="hero"><div><p className="eyebrow"><Sparkles size={14}/> CNN 可视化工作台</p><h1>让每一步学习<span>看得见</span></h1><p>从数据、卷积到训练结果，在一个实验中理解图像识别模型如何工作。</p></div><div className="hero-steps"><span className="done"><Check size={14}/> 选择数据</span><ArrowRight size={15}/><span className="done"><Check size={14}/> 配置网络</span><ArrowRight size={15}/><span className={running ? 'current' : ''}><Activity size={14}/> 训练模型</span></div></section>
    <div className="workspace">
      <aside className="left-panel">
        <PanelTitle icon={<Database size={17}/>} label="数据集" pill={`${1200 + files.length} 张`}/><p className="panel-subtitle">课堂演示 · 手写数字 / 动物识别</p>
        <div className="dataset-card"><div className="dataset-visual"><span className="mini-digit">4</span><span className="mini-digit cyan">7</span><span className="mini-digit lime">2</span></div><div><b>Mini Vision Set</b><small>10 个类别 · 1200 张图片</small></div><ChevronDown size={16}/></div>
        <input ref={input} onChange={e => onFiles(e.target.files)} type="file" accept="image/*" multiple hidden/>
        <button className="upload-zone" onClick={() => input.current?.click()}><Upload size={20}/><b>添加你的训练图片</b><span>支持 JPG、PNG，文件将保留在本机</span></button>
        {files.length > 0 && <div className="uploaded-list"><span><Image size={14}/> 待标注图片</span><b>{files.length}</b></div>}
        <div className="split"><span>训练集 <b>960</b></span><div><i style={{width:'80%'}}/></div><span>验证集 <b>240</b></span></div>
        <div className="divider"/>
        <PanelTitle icon={<Settings2 size={17}/>} label="训练参数"/>
        <div className="parameters"><label>学习率 <span>0.001</span></label><label>批次大小 <span>32</span></label><label>最大轮次 <span>30</span></label></div>
        <button className="text-button" onClick={() => notify('参数配置已展开：本教学版固定使用推荐参数')}><Settings2 size={15}/> 调整训练参数</button>
      </aside>
      <section className="center-panel">
        <div className="section-heading"><div><p className="eyebrow">模型构建</p><h2>轻量卷积神经网络 <span className="tag">CNN</span></h2></div><button className="outline-btn" onClick={() => notify('网络结构：2 层卷积 + 最大池化 + 全连接分类器')}><Eye size={16}/> 查看网络结构</button></div>
        <div className="network"><div className="network-stage"><div className="input-grid">{Array.from({length:25},(_,i)=><i key={i} style={{opacity:.2+(i%5)/7}}/>)}</div><span>输入图像</span><small>28 × 28 × 1</small></div><NetworkArrow label="Conv 3×3"/><div className="network-stage"><div className="feature-stack"><i/><i/><i/><i/></div><span>特征提取</span><small>26 × 26 × 8</small></div><NetworkArrow label="MaxPool"/><div className="network-stage"><div className="feature-stack deep"><i/><i/><i/><i/><i/></div><span>深层特征</span><small>12 × 12 × 16</small></div><NetworkArrow label="Dense"/><div className="network-stage"><div className="class-bars"><i/><i/><i/><i/><i/></div><span>分类结果</span><small>10 个类别</small></div></div>
        <div className="training-card"><div className="training-head"><div><span className={running ? 'status running' : epoch >= 30 ? 'status complete' : 'status'}><i/>{running ? '正在训练' : epoch >= 30 ? '训练完成' : '已暂停'}</span><h3>训练进度</h3></div><div className="epoch"><b>Epoch {epoch}</b><span>/ 30</span></div></div><div className="progress"><i style={{width:`${Math.max(0,epoch/30*100)}%`}}/></div><div className="metric-row"><Metric name="训练准确率" value={latest ? `${latest.accuracy.toFixed(1)}%` : '—'} trend="↑ 1.8%"/><Metric name="验证准确率" value={latest ? `${latest.val.toFixed(1)}%` : '—'} trend="↑ 1.5%"/><Metric name="训练损失" value={latest ? latest.loss.toFixed(3) : '—'} trend="↓ 0.04" good/></div><div className="chart-wrap"><ResponsiveContainer width="100%" height={174}><AreaChart data={metrics}><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5c79f2" stopOpacity={.22}/><stop offset="100%" stopColor="#5c79f2" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#e9ebf2" vertical={false}/><XAxis dataKey="epoch" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#9299aa'}}/><YAxis domain={[0,100]} tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#9299aa'}} width={27}/><Tooltip formatter={(v:number)=>`${v.toFixed(1)}%`} labelFormatter={v=>`第 ${v} 轮`}/><Area type="monotone" dataKey="accuracy" stroke="#5c79f2" strokeWidth={2.5} fill="url(#fill)"/><Area type="monotone" dataKey="val" stroke="#22b8a5" strokeWidth={2.5} fill="none"/></AreaChart></ResponsiveContainer><div className="legend"><span><i className="blue"/> 训练准确率</span><span><i className="green"/> 验证准确率</span></div></div></div>
        <div className="controls"><button className="primary-btn" onClick={running ? onPause : onStart}>{running ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}{running ? '暂停训练' : epoch >= 30 ? '再次训练' : epoch === 0 ? '开始训练' : '继续训练'}</button><button className="ghost-btn" onClick={onRestart}><RefreshCw size={16}/> 重置实验</button><span className="training-note"><Cpu size={15}/> 纯浏览器模拟，无需上传数据</span></div>
      </section>
      <aside className="right-panel"><PanelTitle icon={<Lightbulb size={17}/>} label="本轮发生了什么？"/><p className="explain">模型正在对比预测结果与真实标签，并根据误差微调卷积核中的数字。</p><div className="explain-flow"><div className="flow-step active"><span>01</span><div><b>卷积扫描</b><small>提取边缘、纹理等局部特征</small></div></div><div className="flow-line"/><div className="flow-step"><span>02</span><div><b>计算预测</b><small>判断图片属于哪个类别</small></div></div><div className="flow-line"/><div className="flow-step"><span>03</span><div><b>反向传播</b><small>让下一次预测更准确</small></div></div></div><div className="tip"><Sparkles size={16}/><p><b>试试看</b><br/>切换到「卷积透镜」，亲手移动卷积核，观察每个格子如何计算。</p></div><button className="lesson-link" onClick={() => notify('课堂提示：卷积核像一个可学习的特征探测器')}>为什么卷积适合识别图像？ <ArrowRight size={15}/></button></aside>
    </div>
  </div>
}

function PanelTitle({icon,label,pill}:{icon:React.ReactNode;label:string;pill?:string}) { return <div className="panel-title"><div>{icon}<b>{label}</b></div>{pill && <span>{pill}</span>}</div> }
function NetworkArrow({label}:{label:string}) { return <div className="network-arrow"><span>{label}</span><i><ArrowRight size={15}/></i></div> }
function Metric({name,value,trend,good}:{name:string;value:string;trend:string;good?:boolean}) { return <div className="metric"><span>{name}</span><b>{value}</b><small className={good ? 'good' : ''}>{trend}</small></div> }

function Convolution() {
  const [kernelName, setKernelName] = useState<keyof typeof kernels>('边缘检测')
  const [pos, setPos] = useState({row:0,col:0})
  const kernel = kernels[kernelName]
  const calc = useMemo(() => { const vals = kernel.flatMap((line,r) => line.map((v,c) => v * matrix[pos.row+r][pos.col+c])); return {vals, sum: vals.reduce((a,b)=>a+b,0), activation: Math.max(0, vals.reduce((a,b)=>a+b,0))} }, [kernel,pos])
  return <div className="page lens-page"><section className="lens-intro"><p className="eyebrow"><Grid3X3 size={14}/> 交互式卷积演示</p><h1>用一扇小窗，<span>读懂整张图</span></h1><p>卷积核每次覆盖输入图像的一小块区域，逐元素相乘并相加，生成一张新的特征图。</p></section><div className="lens-grid"><section className="convolution-card"><div className="card-head"><div><h2>卷积操作现场</h2><p>点击输入图像的不同区域，移动 3×3 卷积核。</p></div><div className="select-wrap"><span>卷积核</span><select value={kernelName} onChange={e=>setKernelName(e.target.value as keyof typeof kernels)}>{Object.keys(kernels).map(k=><option key={k}>{k}</option>)}</select></div></div><div className="convolution-scene"><div className="matrix-side"><h4>输入图像 <small>5 × 5 灰度</small></h4><div className="data-matrix input-matrix">{matrix.flatMap((line,r)=>line.map((v,c)=>{const selected=r>=pos.row&&r<pos.row+3&&c>=pos.col&&c<pos.col+3; return <button key={`${r}${c}`} onClick={()=>setPos({row:Math.min(2,Math.max(0,r-1)),col:Math.min(2,Math.max(0,c-1))})} className={selected?'selected':''} style={{background:`rgb(${255-v*1.8}, ${255-v*1.4}, ${255-v*.8})`}}>{v}</button>}))}</div></div><div className="operation"><span>×</span><i/> <span>+</span><i/> <span>=</span></div><div className="matrix-side"><h4>卷积核 <small>3 × 3</small></h4><div className="data-matrix kernel-matrix">{kernel.flatMap((line,r)=>line.map((v,c)=><div key={`${r}${c}`} className={v<0?'negative':v>1?'positive':''}>{v}</div>))}</div></div><div className="result-number"><h4>输出</h4><b>{calc.activation}</b><small>ReLU 后的特征值</small></div></div><div className="equation"><span>本次计算</span><code>{calc.vals.map(v => v>=0?`+${v}`:v).join(' ')} <b>= {calc.sum}</b> → ReLU → <strong>{calc.activation}</strong></code></div></section><aside className="how-card"><p className="eyebrow">逐步理解</p><h2>现在看到了什么？</h2><ol><li><span>1</span><p><b>取一小块像素</b>卷积核正覆盖输入图像中橙色标出的 3×3 区域。</p></li><li><span>2</span><p><b>对应元素相乘</b>每个像素值都与卷积核相同位置的权重相乘。</p></li><li><span>3</span><p><b>相加得到特征</b>所有结果相加，得到这个位置的边缘响应强度。</p></li></ol><div className="pro-tip"><BrainCircuit size={19}/><p><b>知识点</b>卷积核的数值不是人工设定的；在训练中，它们会自动学会检测有用的图案。</p></div></aside></div><section className="feature-output"><div><p className="eyebrow">完整输出</p><h2>特征图（Feature Map）</h2><p>随着卷积核在图像上滑动，每个位置都会生成一个数，组合成这张特征图。</p></div><div className="output-matrix">{Array.from({length:9},(_,i)=><i key={i} style={{opacity:.2+(i*7%10)/10,background: i===pos.row*3+pos.col ? '#f6a94a' : undefined}}>{i===pos.row*3+pos.col ? calc.activation : Math.max(0,Math.round(Math.sin(i*4)*160))}</i>)}</div></section></div>
}

function Inference({files,notify}:{files:File[];notify:(s:string)=>void}) {
  const input = useRef<HTMLInputElement>(null); const [image,setImage]=useState<string|undefined>(); const [result,setResult]=useState(false)
  const pick=(list:FileList|null)=>{const f=list?.[0];if(f){setImage(URL.createObjectURL(f));setResult(false)}}
  return <div className="page inference-page"><section className="lens-intro"><p className="eyebrow"><Rocket size={14}/> 训练好的模型</p><h1>给模型一张图，<span>看看它怎么想</span></h1><p>上传一张图片，观察模型的预测类别、置信度和它关注的图像区域。</p></section><div className="inference-grid"><section className="try-card"><div className="card-head"><div><h2>图片识别</h2><p>本地图片不会离开你的设备。</p></div><span className="model-ready"><Check size={14}/> 模型已就绪</span></div><input ref={input} type="file" accept="image/*" hidden onChange={e=>pick(e.target.files)}/>{image?<div className="preview-wrap"><img src={image}/><button onClick={()=>{setImage(undefined);setResult(false)}}><X size={16}/></button></div>:<button className="large-drop" onClick={()=>input.current?.click()}><div><FileUp size={28}/></div><b>选择一张图片</b><span>JPG 或 PNG，建议使用清晰的单个主体图像</span></button>}<button disabled={!image} className="primary-btn full" onClick={()=>{setResult(true);notify('预测完成：模型已生成分类结果')}}><Sparkles size={17}/> 让模型识别</button></section><section className="prediction-card"><p className="eyebrow">模型输出</p>{result?<><div className="prediction-main"><div className="prediction-icon">{image?<img src={image}/>:<Image/>}</div><div><span>最可能是</span><h2>猫 <em>92.4%</em></h2><p>模型对这一判断很有信心</p></div></div><div className="probabilities"><Probability label="猫" value={92.4} color="#5c79f2"/><Probability label="狗" value={5.8} color="#22b8a5"/><Probability label="其他" value={1.8} color="#f6a94a"/></div><div className="attention"><div><b>模型关注区域</b><small>暖色区域对本次判断贡献最大</small></div><div className="heatmap"><i/><i/><i/><i/><i/></div></div></>:<div className="empty-result"><BrainCircuit size={40}/><b>等待一张图片</b><p>上传图片并点击识别，结果会显示在这里。</p></div>}</section></div><section className="model-summary"><div><Cpu size={20}/><p><b>当前使用：MiniVision CNN</b><span>2 个卷积层 · 约 18,000 个可训练参数 · 10 个图像类别</span></p></div><button className="outline-btn" onClick={()=>notify(files.length ? `你的数据集中已有 ${files.length} 张待标注图片` : '可回到实验台导入你自己的训练图片')}><Database size={16}/> 管理训练数据</button></section></div>
}
function Probability({label,value,color}:{label:string;value:number;color:string}) {return <div className="probability"><span>{label}</span><div><i style={{width:`${value}%`,background:color}}/></div><b>{value}%</b></div>}

createRoot(document.getElementById('root')!).render(<App />)
