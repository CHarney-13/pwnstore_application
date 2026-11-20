import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: false,
    rollupOptions: {
      input: mode === 'preload' ? { preload: 'src/preload.ts' } : { main: 'src/main/main.ts' },
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
    },
  },
}));
