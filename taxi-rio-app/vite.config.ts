import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const apiProxy = {
  '/auth': { target: 'http://localhost:3000', changeOrigin: true },
  '/corridas': { target: 'http://localhost:3000', changeOrigin: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
    ],
  },
})
