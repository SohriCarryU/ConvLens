import { INPUT } from './cnn.ts'

export type ImageInput = { pixels: number[]; original?: string; name: string }

// Uploads and drawings use the same grayscale, letterboxing and normalization.
export function imagePixels(source: HTMLImageElement | HTMLCanvasElement): number[] {
  // Normalize the source type: browsers can downsample images and live canvases differently.
  // Progressively shrink to retain thin strokes instead of sampling past them at 16×16.
  let raster = document.createElement('canvas')
  const sourceScale = Math.min(1, 1024 / Math.max(source.width, source.height))
  raster.width = Math.max(1, Math.round(source.width * sourceScale))
  raster.height = Math.max(1, Math.round(source.height * sourceScale))
  const rasterContext = raster.getContext('2d')!
  rasterContext.imageSmoothingQuality = 'high'
  rasterContext.drawImage(source, 0, 0, raster.width, raster.height)
  while (Math.max(raster.width, raster.height) > INPUT * 2) {
    const reduced = document.createElement('canvas')
    reduced.width = Math.max(1, Math.ceil(raster.width / 2))
    reduced.height = Math.max(1, Math.ceil(raster.height / 2))
    reduced.getContext('2d')!.drawImage(raster, 0, 0, reduced.width, reduced.height)
    raster = reduced
  }
  // Normalize the foreground bounding box first. MNIST and the drawing pad both
  // have a black margin, but their digit position and canvas usage differ.
  const sourcePixels = raster.getContext('2d')!.getImageData(0, 0, raster.width, raster.height).data
  let left = raster.width, top = raster.height, right = -1, bottom = -1
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    const at = (y * raster.width + x) * 4
    const value = (sourcePixels[at] * .299 + sourcePixels[at + 1] * .587 + sourcePixels[at + 2] * .114) / 255
    if (value > .08) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
  }
  const hasForeground = right >= left && bottom >= top
  const margin = hasForeground ? Math.max(1, Math.round(Math.max(right - left + 1, bottom - top + 1) * .12)) : 0
  const cropLeft = hasForeground ? Math.max(0, left - margin) : 0
  const cropTop = hasForeground ? Math.max(0, top - margin) : 0
  const cropRight = hasForeground ? Math.min(raster.width - 1, right + margin) : raster.width - 1
  const cropBottom = hasForeground ? Math.min(raster.height - 1, bottom + margin) : raster.height - 1
  const cropWidth = cropRight - cropLeft + 1, cropHeight = cropBottom - cropTop + 1
  const side = Math.max(cropWidth, cropHeight)
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropCanvas.height = side
  const cropContext = cropCanvas.getContext('2d')!
  cropContext.fillStyle = '#000'
  cropContext.fillRect(0, 0, side, side)
  cropContext.drawImage(raster, cropLeft, cropTop, cropWidth, cropHeight, (side - cropWidth) / 2, (side - cropHeight) / 2, cropWidth, cropHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = INPUT
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, INPUT, INPUT)
  const scale = (INPUT - 2) / side
  const w = side * scale, h = side * scale
  ctx.drawImage(cropCanvas, (INPUT - w) / 2, (INPUT - h) / 2, w, h)
  const rgba = ctx.getImageData(0, 0, INPUT, INPUT).data
  return Array.from({ length: INPUT * INPUT }, (_, i) => (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) / 255)
}

export async function readImage(file: File): Promise<ImageInput> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片`)
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} 超过 15 MB，请先缩小图片`)
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`无法解码 ${file.name}，请使用 PNG、JPG 或 WebP`))
    image.src = original
  })
  return { name: file.name, original, pixels: imagePixels(image) }
}
