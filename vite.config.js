import { defineConfig } from 'vite';

// Vite config. base './' so assets resolve correctly inside the Capacitor WebView
// (which loads from a file:// / capacitor:// origin rather than a web server root).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    port: 5173,
  },
});
