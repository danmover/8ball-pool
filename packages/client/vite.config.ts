import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true, // listen on the LAN too, so a phone can reach the dev server via your machine's IP
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
