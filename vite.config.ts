import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __SAMSUNG_TV__: mode === 'samsung' },
  build: {
    outDir: mode === 'samsung' ? 'dist-samsung' : 'dist',
    target: mode === 'samsung' ? 'chrome108' : 'baseline-widely-available',
    // Three.js is most of the bundle; one chunk loads fine for a single-page game.
    chunkSizeWarningLimit: 900,
  },
}));
