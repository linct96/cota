import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  test: { include: ['tests/**/*.test.{ts,tsx}'], restoreMocks: true },
})
