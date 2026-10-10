import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^https:\/\/deno\.land\/.*/, replacement: path.resolve(import.meta.dirname, 'src/test/denoHttpStub.ts') },
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js.*/, replacement: '@supabase/supabase-js' },
      { find: /^npm:livekit-server-sdk.*/, replacement: path.resolve(import.meta.dirname, 'src/test/livekitSdkStub.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules', 'e2e/**', 'supabase/functions/**'],
  },
})
