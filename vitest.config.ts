import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

// Dedicated Vitest config so unit tests run against a plain React + jsdom
// environment, isolated from the app's SSR/Nitro Vite plugins in vite.config.ts.
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    server: {
      deps: {
        inline: ['convex-test'],
      },
    },
  },
})
