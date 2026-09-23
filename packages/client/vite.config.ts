import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pwaManifest } from './build/pwa';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  // Straight from source: the engine hot-reloads alongside the UI, and a build never picks up a
  // stale compiled copy of it.
  resolve: { alias: { '@8ball/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: {
    port: 5173,
    // Listen on the LAN too, so a phone on the same wifi can reach the dev server.
    host: true,
  },
  worker: { format: 'es' },
  // Pre-bundled up front, so the dev server never re-optimises mid-session and loads a second
  // copy of Preact (which breaks hooks).
  optimizeDeps: { include: ['preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals', 'three', 'qrcode'] },
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  plugins: [pwaManifest()],
});
