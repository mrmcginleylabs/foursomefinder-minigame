import { defineConfig } from 'vite';

// Flat project: index.html + main.js + gameHtml.js live at the repo root.
export default defineConfig({
  base: './',
  server: { port: 5174 },
  build: { outDir: 'dist' }
});
