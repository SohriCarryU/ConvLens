import { useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

export const fmt = (value: number, digits = 4) => Number.isFinite(value) ? value.toFixed(digits) : '—'
export const pct = (value: number) => `${(value * 100).toFixed(1)}%`
export type WindowPosition = { row: number; col: number; size: number }

export function PixelMap({ values, width, label, signed = false, gray = false, window, onSelect, revealed, scale }: {
  values: number[]; width: number; label: string; signed?: boolean; gray?: boolean;
  window?: WindowPosition; onSelect?: (row: number, col: number) => void; revealed?: number; scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const height = Math.ceil(values.length / width)
  useEffect(() => {
    const canvas = ref.current, cell = 16
    if (!canvas) return
    canvas.width = width * cell
    canvas.height = height * cell
    const ctx = canvas.getContext('2d')!
    const max = scale ?? Math.max(...values.map(Math.abs), 1e-8)
    values.forEach((v, i) => {
      const n = Math.min(1, Math.abs(v) / max)
      if (revealed !== undefined && i > revealed) ctx.fillStyle = '#f3f4f6'
      else if (gray) { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); ctx.fillStyle = `rgb(${c},${c},${c})` }
      else if (signed && v < 0) ctx.fillStyle = `rgb(${Math.round(246 - n * 45)},${Math.round(241 - n * 138)},${Math.round(235 - n * 139)})`
      else ctx.fillStyle = `rgb(${Math.round(240 - n * 186)},${Math.round(245 - n * 122)},${Math.round(234 - n * 158)})`
      ctx.fillRect(i % width * cell, Math.floor(i / width) * cell, cell, cell)
      ctx.strokeStyle = gray ? '#ffffff12' : '#ffffff30'
      ctx.strokeRect(i % width * cell, Math.floor(i / width) * cell, cell, cell)
    })
    if (window) {
      ctx.fillStyle = '#e9ad4833'
      ctx.fillRect(window.col * cell, window.row * cell, window.size * cell, window.size * cell)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#e9ad48'
      ctx.strokeRect(window.col * cell + 1, window.row * cell + 1, window.size * cell - 2, window.size * cell - 2)
    }
  }, [values, width, height, signed, gray, window, revealed, scale])

  const select = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return
    const canvas = event.currentTarget, rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const col = Math.floor((event.clientX - rect.left) / rect.width * width)
    const row = Math.floor((event.clientY - rect.top) / rect.height * height)
    if (Number.isFinite(row) && Number.isFinite(col)) onSelect(Math.min(height - 1, Math.max(0, row)), Math.min(width - 1, Math.max(0, col)))
  }
  const key = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!onSelect || !window) return
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const d = directions[event.key]
    if (d) { event.preventDefault(); onSelect(window.row + d[0], window.col + d[1]) }
  }
  return <canvas ref={ref} className={`pixel-map ${onSelect ? 'interactive' : ''}`} aria-label={label} role={onSelect ? 'button' : 'img'} tabIndex={onSelect ? 0 : undefined} onClick={select} onKeyDown={key}/>
}

export function Weights({ values, selected, onSelect, digits = 4 }: { values: number[]; selected?: number; onSelect?: (i: number) => void; digits?: number }) {
  return <div className="weights-grid">{values.map((v, i) => <button key={i} className={`${v < 0 ? 'negative' : ''} ${i === selected ? 'selected' : ''}`} onClick={() => onSelect?.(i)} disabled={!onSelect} aria-label={`权重 ${Math.floor(i / 3) + 1}, ${i % 3 + 1}: ${fmt(v, digits)}`}>{fmt(v, digits)}</button>)}</div>
}

export function Probabilities({ labels, values, target, previous }: { labels: string[]; values: number[]; target?: number; previous?: number[] }) {
  return <div className="probability-list">{labels.map((label, i) => <div className={`probability-line ${target === i ? 'target' : ''}`} key={label}>
    <span>{label}{target === i && <small>真实标签</small>}</span><div className="probability-track"><i style={{ width: `${values[i] * 100}%` }}/></div><b>{pct(values[i])}</b>{previous && <small>更新前 {pct(previous[i])}</small>}
  </div>)}</div>
}
