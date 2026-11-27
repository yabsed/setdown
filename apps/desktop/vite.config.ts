import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { METAFILE_WORKERS, isMetafileModule, patchMetafileOutlines } from './scripts/office-metafile-patch.mjs';

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

/**
 * File Viewer's EMF converter with outlines built as GDI builds them (`scripts/office-metafile-patch.mjs`).
 * The two worker scripts are published by URL: `virtual:office-metafile-worker/pptx` and `…/ppt` give the
 * address of the corrected script, `office-metafile-<name>.worker-<hash>.js`. The packages still name their
 * published scripts as a default for a viewer mounted without addresses, so those are bundled too; Setdown
 * always passes the corrected ones, and `media/office-reader.spec.ts` checks which scripts start. The two modules that reach the application's own chunks are corrected
 * as they are read: by `transform` in a build, and by `metafileOutlinesForDependencies` where the dev
 * server bundles dependencies ahead of time.
 */
const WORKER_MODULE = 'virtual:office-metafile-worker/';
const WORKER_ROUTE = '/office-metafile-worker';
function metafileOutlines() {
  const require = createRequire(import.meta.url);
  const workers = new Map(Object.entries(METAFILE_WORKERS).map(([name, module]) => [name, require.resolve(module)] as const));
  const corrected = (name: string) => patchMetafileOutlines(readFileSync(workers.get(name)!, 'utf8'));
  let serving = false;
  return {
    name: 'office-metafile-outlines',
    configResolved(config: import('vite').ResolvedConfig) { serving = config.command === 'serve'; },
    resolveId(id: string) { return id.startsWith(WORKER_MODULE) && workers.has(id.slice(WORKER_MODULE.length)) ? `\0${id}` : null; },
    load(this: import('rollup').PluginContext, id: string) {
      if (!id.startsWith(`\0${WORKER_MODULE}`)) return null;
      const name = id.slice(WORKER_MODULE.length + 1);
      if (serving) return `export default ${JSON.stringify(`${WORKER_ROUTE}/${name}.js`)};`;
      return `export default import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'asset', name: `office-metafile-${name}.worker.js`, source: corrected(name) })};`;
    },
    transform(code: string, id: string) { return isMetafileModule(id) ? { code: patchMetafileOutlines(code), map: null } : null; },
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(WORKER_ROUTE, (request, response, next) => {
        const name = (request.url ?? '').slice(1).split('?')[0].replace(/\.js$/, '');
        if (!workers.has(name)) { next(); return; }
        response.setHeader('Content-Type', 'text/javascript');
        response.end(corrected(name));
      });
    },
  };
}
/** The same correction for the dev server's bundled dependencies. Its name carries the correction's own text, so a changed correction bundles them again. */
const metafileOutlinesForDependencies = {
  name: `office-metafile-outlines-${createHash('sha256').update(readFileSync(new URL('./scripts/office-metafile-patch.mjs', import.meta.url))).digest('hex').slice(0, 12)}`,
  setup(build: import('esbuild').PluginBuild) {
    build.onLoad({ filter: /[\\/]vector\.js$/ }, args => isMetafileModule(args.path)
      ? { contents: patchMetafileOutlines(readFileSync(args.path, 'utf8')), loader: 'js' as const } : undefined);
  },
};

export default defineConfig({
  base: './',
  resolve: { alias: {
    '@crossnote-styles': path.resolve(path.dirname(createRequire(import.meta.url).resolve('crossnote')), '../styles'),
    // The web reader names KaTeX's WOFF2 files itself (renderer/browser/reader-math.ts), wherever the package is installed.
    '@katex-fonts': path.join(path.dirname(createRequire(import.meta.url).resolve('katex')), 'fonts'),
    // Saving a workbook as PDF reuses File Viewer's chart drawing, which the package keeps internal.
    '@file-viewer-spreadsheet-chart': path.join(path.dirname(createRequire(import.meta.url).resolve('@file-viewer/renderer-spreadsheet/package.json')), 'dist/spreadsheet/chartRenderer.js'),
  } },
  plugins: [svelte(), pdfAssets(), metafileOutlines()],
  // 기본 HTML 탐색은 참고용 vendor 저장소의 fixture/workbench 페이지까지 훑는다.
  // 앱의 유일한 진입점만 지정해 VS Code 소스를 dependency로 오인하지 않게 한다.
  optimizeDeps: {
    entries: ['index.html'],
    // The Word and presentation engines locate their HarfBuzz WASM and the fonts package its font
    // files with `new URL(..., import.meta.url)`. Pre-bundling moves that code away from those files,
    // so the dev server serves these packages as they are published.
    exclude: ['@docx-editor.dev/core', '@docx-editor.dev/fonts', '@docx-editor.dev/fonts-cjk', '@pptx-editor.dev/core'],
    esbuildOptions: { plugins: [metafileOutlinesForDependencies] },
  },
  server: {
    // Electron owns these pages/preloads. Rebuilding them must not reload the
    // renderer while its native browser views and extension host stay alive.
    watch: { ignored: ['**/dist-electron/**'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
