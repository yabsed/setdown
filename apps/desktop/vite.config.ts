import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function pdfAssets() {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const assets = new Map<string, string>(['cmaps', 'standard_fonts', 'wasm'].flatMap((folder) =>
    readdirSync(path.join(root, folder)).map((name) => [`${folder}/${name}`, path.join(root, folder, name)] as const)));
  return {
    name: 'pdf-assets',
    generateBundle(this: import('rollup').PluginContext) {
      for (const [name, file] of assets) this.emitFile({ type: 'asset', fileName: `pdf-assets/${name}`, source: readFileSync(file) });
    },
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const file = assets.get((request.url ?? '').slice(1).split('?')[0]);
        if (!file) { next(); return; }
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), pdfAssets()],
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
