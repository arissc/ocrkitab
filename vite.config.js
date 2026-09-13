import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
})