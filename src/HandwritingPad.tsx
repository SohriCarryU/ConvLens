import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { imagePixels } from './dataset.ts'
import type { ImageInput } from './dataset.ts'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; width: number }
const SIZE = 320

function paint(ctx: CanvasRenderingContext2D, point: Point, previous: Point | undefined, width: number) {
  ctx.strokeStyle = ctx.fillStyle = '#fff'
  ctx.lineWidth = width
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.beginPath()
  if (previous) {
    ctx.moveTo(previous.x, previous.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  } else {
    ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function HandwritingPad({ onChange }: { onChange: (image: ImageInput | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const pointer = useRef<number | null>(null)
  const [count, setCount] = useState(0)
  const [width, setWidth] = useState(24)

  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, SIZE, SIZE)
  }, [])

  const publish = () => onChange(strokes.current.length ? { name: '手写输入', pixels: imagePixels(canvas.current!) } : null)
  const position = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(SIZE, (event.clientX - rect.left) / rect.width * SIZE)), y: Math.max(0, Math.min(SIZE, (event.clientY - rect.top) / rect.height * SIZE)) }
  }
  const release = () => {
    const id = pointer.current
    pointer.current = null
    if (id !== null && canvas.current?.hasPointerCapture(id)) canvas.current.releasePointerCapture(id)
  }
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || event.button !== 0 || pointer.current !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current = event.pointerId
    const point = position(event)
    strokes.current.push({ points: [point], width })
    paint(event.currentTarget.getContext('2d')!, point, undefined, width)
    setCount(strokes.current.length)
    publish()
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== event.pointerId) return
    const stroke = strokes.current[strokes.current.length - 1]
    const point = position(event)
    paint(event.currentTarget.getContext('2d')!, point, stroke.points[stroke.points.length - 1], stroke.width)
    stroke.points.push(point)
    publish()
  }
  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== event.pointerId) return
    if (event.type === 'pointerup') move(event)
    release()
  }
  const redraw = (clear: boolean) => {
    release()
    if (clear) strokes.current = []
    else strokes.current.pop()
    const ctx = canvas.current!.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, SIZE, SIZE)
    for (const stroke of strokes.current) stroke.points.forEach((point, i) => paint(ctx, point, stroke.points[i - 1], stroke.width))
    setCount(strokes.current.length)
    publish()
  }

  return <div className="handwriting-pad">
    <div className="drawing-surface">
      <canvas ref={canvas} width={SIZE} height={SIZE} aria-label="手写画板" aria-describedby="drawing-help" tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onContextMenu={e => e.preventDefault()} onKeyDown={e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); redraw(true) } }}/>
      {!count && <span className="drawing-placeholder" aria-hidden="true">在这里书写</span>}
    </div>
    <div className="drawing-toolbar"><label>笔画<input type="range" aria-label="笔画粗细" min={12} max={36} step={2} value={width} onChange={e => setWidth(Number(e.target.value))}/></label><button className="ghost-btn" disabled={!count} onClick={() => redraw(false)}><RotateCcw size={15}/>撤销</button><button className="outline-btn" disabled={!count} onClick={() => redraw(true)}><Trash2 size={15}/>清空</button></div>
    <p id="drawing-help" className="caption">鼠标或触屏书写，尽量居中并写满画板。</p>
  </div>
}
