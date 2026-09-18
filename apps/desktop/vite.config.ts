import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  // 기본 HTML 탐색은 참고용 vendor 저장소의 fixture/workbench 페이지까지 훑는다.
  // 앱의 유일한 진입점만 지정해 VS Code 소스를 dependency로 오인하지 않게 한다.
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
