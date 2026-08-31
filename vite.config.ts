import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build output is a static bundle: no server framework, no backend.
// Everything (PDFium WASM, Tesseract WASM, pdf-lib) runs in the browser/webview,
// which is what lets Tauri package it as an offline desktop app.
export default defineConfig({
  plugins: [react()],
  build: {
    // Tauri's webviews are modern; no legacy transpilation needed.
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
