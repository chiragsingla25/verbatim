import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Prepended to the bundled pdf.js web worker. The worker runs in its own realm and
// never sees src/lib/polyfills.ts, but pdfjs-dist v4 calls Promise.withResolvers()
// inside the worker too — absent on browsers older than Chrome 119 / FF 121 /
// Safari 17.4. Keep in sync with src/lib/polyfills.ts.
const WORKER_POLYFILL =
  'if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){' +
  'var a,b,p=new this(function(res,rej){a=res;b=rej});return{promise:p,resolve:a,reject:b}}}'

// Base path is set from VITE_APP_BASE (=/verbatim/) so the bundle and the router agree —
// the app is served at https://<user>.github.io/verbatim/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_APP_BASE || '/verbatim/',
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    worker: {
      format: 'es',
      rollupOptions: { output: { banner: WORKER_POLYFILL } },
    },
  }
})
