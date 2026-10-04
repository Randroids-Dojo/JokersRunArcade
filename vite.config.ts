import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // Three.js is most of the bundle; one chunk loads fine for a single-page game.
    chunkSizeWarningLimit: 900,
  },
});
