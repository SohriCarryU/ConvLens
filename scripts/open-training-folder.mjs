import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const endpoint = '/__convlens/open-training-folder'
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

async function openFolder(directory) {
  const command = { darwin: 'open', win32: 'explorer.exe', linux: 'xdg-open' }[process.platform]
  if (!command) throw new Error('Unsupported platform')
  await run(command, [directory], { timeout: 10000 })
}

export function openTrainingFolderMiddleware(directory, open = openFolder) {
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== endpoint) return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    const reply = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)) }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return reply(405, { error: '请点击「打开素材文件夹」按钮。' })
    }
    // Only this app, accessed on the server's own machine, can open the fixed folder.
    let sameOrigin = false
    try {
      const origin = new URL(req.headers.origin)
      sameOrigin = localHosts.has(origin.hostname) && origin.host === req.headers.host &&
        origin.protocol === (req.socket.encrypted ? 'https:' : 'http:')
    } catch { /* Missing or invalid origin. */ }
    if (!sameOrigin || !localAddresses.has(req.socket.remoteAddress) ||
        req.headers['x-convlens-action'] !== 'open-training-folder') {
      return reply(403, { error: '请在运行网站的电脑上，通过 localhost 或 127.0.0.1 打开网站后重试。' })
    }
    try {
      if (!(await stat(directory)).isDirectory()) return reply(404, { error: '训练素材文件夹不存在。' })
    } catch {
      return reply(404, { error: '无法找到或读取训练素材文件夹。' })
    }
    try {
      await open(directory)
      reply(200, { opened: true })
    } catch {
      reply(500, { error: '无法打开系统文件管理器，请手动打开训练素材文件夹。' })
    }
  }
}
