/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_BASE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Build identifier baked in at build time (git SHA on CI, timestamp locally).
// Compared against /version.json at runtime to reload a stale tab after a deploy.
declare const __BUILD_ID__: string
