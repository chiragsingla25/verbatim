import { defineConfig } from 'vitest/config'

// SPA unit tests only. Edge Function tests run under Deno (`pnpm test:functions`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
