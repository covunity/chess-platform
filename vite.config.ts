import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules', 'e2e/**'],
    // VariationPanel gates the promote action behind this flag in production
    // (feature still in flight). Tests assume the action is wired, so opt in.
    env: {
      VITE_ALLOW_VARIATIONS: 'true',
    },
  },
})
