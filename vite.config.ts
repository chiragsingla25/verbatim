import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Prepended to the bundled pdf.js web worker. The worker runs in its own realm and
// never sees src/lib/polyfills.ts, but pdfjs-dist v4 calls Promise.withResolvers()
// inside the worker too — absent on browsers older than Chrome 119 / FF 121 /
// Safari 17.4. Keep in sync with src/lib/polyfills.ts.
const WORKER_POLYFILL =
  'if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){' +
  'var a,b,p=new this(function(res,rej){a=res;b=rej});return{promise:p,resolve:a,reject:b}}}'

// A per-build identifier: the commit SHA on CI, else a local timestamp. Baked into
// the bundle as __BUILD_ID__ and emitted as /version.json so a stale GitHub Pages
// tab can detect a newer deploy and reload itself (see src/lib/version-check.ts).
function buildId(): string {
  const sha = process.env.GITHUB_SHA
  if (sha) return sha.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD').toString().trim()
  } catch {
    return `dev-${Date.now()}`
  }
}

// Emits version.json at the site root of the production build.
function emitVersionJson(id: string): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id }) })
    },
  }
}

// Base path is set from VITE_APP_BASE (=/verbatim/) so the bundle and the router agree —
// the app is served at https://<user>.github.io/verbatim/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const id = buildId()
  return {
    base: env.VITE_APP_BASE || '/verbatim/',
    define: { __BUILD_ID__: JSON.stringify(id) },
    plugins: [react(), emitVersionJson(id)],
    server: { port: 5173, strictPort: true },
    worker: {
      format: 'es',
      rollupOptions: { output: { banner: WORKER_POLYFILL } },
    },
  }
})
