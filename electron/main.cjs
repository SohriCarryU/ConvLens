const { app, BrowserWindow, shell } = require('electron')
const { createReadStream } = require('node:fs')
const { access, stat } = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const SERVER_PORT = 47831

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

function appRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist')
    : path.join(__dirname, '..', 'dist')
}

function trainingRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'training-data')
    : path.join(appRoot(), 'training-data')
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function safeFilePath(root, pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  const relative = decoded.replace(/^\/+/, '') || 'index.html'
  const resolved = path.resolve(root, relative)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null
}

async function openTrainingFolder(response) {
  try {
    if (!(await stat(trainingRoot())).isDirectory()) return sendJson(response, 404, { error: '训练素材文件夹不存在。' })
    const error = await shell.openPath(trainingRoot())
    if (error) return sendJson(response, 500, { error: '无法打开系统文件管理器，请手动打开训练素材文件夹。' })
    return sendJson(response, 200, { opened: true })
  } catch {
    return sendJson(response, 404, { error: '无法找到或读取训练素材文件夹。' })
  }
}

async function serveFile(response, filePath, fallback = false) {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('Not a file')
    response.writeHead(200, {
      'Cache-Control': filePath.endsWith('manifest.json') ? 'no-store' : 'public, max-age=31536000, immutable',
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
    })
    createReadStream(filePath).pipe(response)
  } catch {
    if (fallback) return serveFile(response, path.join(appRoot(), 'index.html'))
    sendJson(response, 404, { error: '文件不存在。' })
  }
}

async function startServer() {
  const root = appRoot()
  await access(path.join(root, 'index.html'))
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    if (requestUrl.pathname === '/__convlens/open-training-folder') {
      if (request.method !== 'POST' || request.headers['x-convlens-action'] !== 'open-training-folder') {
        return sendJson(response, 405, { error: '请点击「打开素材文件夹」按钮。' })
      }
      return openTrainingFolder(response)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed' })
    const staticRoot = requestUrl.pathname.startsWith('/training-data/') ? trainingRoot() : root
    const filePath = safeFilePath(staticRoot, requestUrl.pathname.startsWith('/training-data/') ? requestUrl.pathname.slice('/training-data'.length) : requestUrl.pathname)
    if (!filePath) return sendJson(response, 400, { error: '无效的文件路径。' })
    return serveFile(response, filePath, requestUrl.pathname === '/')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(SERVER_PORT, '127.0.0.1', resolve)
  })
  return { server, url: `http://127.0.0.1:${SERVER_PORT}` }
}

async function createWindow() {
  const localServer = await startServer()
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.on('closed', () => localServer.server.close())
  await window.loadURL(localServer.url)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) { if (window.isMinimized()) window.restore(); window.focus() }
  })
  app.whenReady().then(() => createWindow().catch(error => {
    console.error(error)
    app.quit()
  }))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
