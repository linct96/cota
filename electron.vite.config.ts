import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // Shared launch helpers and external CLI adapters must resolve from the same directory.
        output: { chunkFileNames: '[name]-[hash].js' },
        input: {
          index: resolve('src/main/index.ts'),
          host: resolve('src/main/host/host-entry.ts'),
          'pi-extension': resolve('src/main/agents/pi-extension.ts'),
          'agent-hook': resolve('src/main/agents/hook-entry.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // The ESM entry imports Node diagnostics; the bundled browser entry is self-contained.
        '@xterm/addon-ligatures': resolve(
          'node_modules/@xterm/addon-ligatures/lib/addon-ligatures.js',
        ),
      },
    },
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
