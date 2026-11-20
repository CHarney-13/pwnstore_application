import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/preload.ts',
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
        inlineDynamicImports: true,
      },
    },
  },
});
