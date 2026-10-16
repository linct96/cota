import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { index: resolve('src/main/index.ts'), host: resolve('src/main/host-entry.ts') },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'renderer-csp',
        transformIndexHtml(html, context) {
          return html
            .replace('__DEV_SCRIPT__', context.server ? "'unsafe-inline'" : '')
            .replace('__DEV_CONNECT__', context.server ? 'ws://127.0.0.1:*' : '')
        },
      },
    ],
    server: { host: '127.0.0.1' },
  },
})
