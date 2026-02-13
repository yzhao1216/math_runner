import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // Required for Capacitor: assets load from relative paths in the native WebView
  build: {
    outDir: 'dist',
  },
})
