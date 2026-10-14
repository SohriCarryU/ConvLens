import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openTrainingFolderMiddleware } from './open-training-folder.mjs'

const supported = /\.(png|jpe?g|webp)$/i
const sort = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })

export async function scanTrainingFiles(root) {
  let directories
  try { directories = await readdir(root, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, images: [] }; throw error }
  const images = []
  async function visit(directory, prefix, label, found) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(sort)
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const file = `${prefix}/${entry.name}`, absolute = join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute, file, label, found)
      else if (entry.isFile() && supported.test(entry.name)) {
        const info = await stat(absolute)
        found.push({ file, label, revision: `${info.mtimeMs}-${info.size}` })
      }
    }
  }
  for (const directory of directories.filter(d => d.isDirectory() && !d.name.startsWith('.')).sort(sort)) {
    const found = []
    await visit(join(root, directory.name), directory.name, directory.name, found)
    images.push(...found.map((image, i) => ({ ...image, split: (i + 1) % 4 === 0 ? 'validation' : 'train' })))
  }
  return { version: 1, images }
}

export function trainingFilesPlugin() {
  let root, previewRoot
  return {
    name: 'training-image-files',
    configResolved(config) {
      root = resolve(config.publicDir, 'training-data')
      previewRoot = resolve(config.root, config.build.outDir, 'training-data')
    },
    configureServer(server) {
      server.middlewares.use(openTrainingFolderMiddleware(root))
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/training-data/manifest.json') return next()
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(await scanTrainingFiles(root)))
        } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: '无法读取训练素材目录' })) }
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(openTrainingFolderMiddleware(previewRoot))
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'training-data/manifest.json', source: JSON.stringify(await scanTrainingFiles(root)) })
    },
  }
}
