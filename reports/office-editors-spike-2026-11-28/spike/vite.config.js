import { defineConfig } from 'vite';
// Built the way Setdown's renderer is: relative addresses, so the pages load from file://.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false, target: 'esnext', rollupOptions: { input: { pptx: 'pptx.html', xlsx: 'xlsx.html' } } },
});
