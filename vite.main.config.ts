import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: 'src/main/index.ts',
        preload: 'src/main/preload.ts',
      },
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
    },
  },
});
