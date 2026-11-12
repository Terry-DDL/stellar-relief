import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'stellar-relief-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => name === 'index.html' || name.startsWith('assets/')).sort()
      if (!files.includes('index.html')) this.error('Offline build is missing index.html')
      const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
      const hash = createHash('sha256').update(worker)
      for (const file of files) {
        const asset = bundle[file]
        hash.update(file).update(asset.type === 'asset' ? asset.source : asset.code)
      }
      const buildId = hash.digest('hex').slice(0, 16)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const BUILD_ID = ${JSON.stringify(buildId)};\nconst FILES = ${JSON.stringify(files)};\n${worker}`,
      })
    },
  }],
})
