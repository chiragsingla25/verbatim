import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Base path is set from VITE_APP_BASE (=/verbatim/) so the bundle and the router agree —
// the app is served at https://<user>.github.io/verbatim/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_APP_BASE || '/verbatim/',
    plugins: [react()],
    server: { port: 5173, strictPort: true },
  }
})
