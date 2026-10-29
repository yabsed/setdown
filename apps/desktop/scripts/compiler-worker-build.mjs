import { build, stop } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

// Prepare workers sequentially before Rollup starts, avoiding simultaneous
// compiler/editor/renderer ASTs. Keep source maps and lazy local worker URLs.
export async function compilerWorkerBuild(root = process.cwd()) {
  const require = createRequire(path.join(root, 'package.json'));
  const entries = new Map([
    ['./typescript.worker?worker', 'src/renderer/language/typescript.worker.ts'],
    ['./json.worker?worker', 'src/renderer/language/json.worker.ts'],
    ['./notebook-search.worker?worker', 'src/renderer/notebook/notebook-search.worker.ts'],
    ...['editor/editor.worker', 'language/css/css.worker', 'language/html/html.worker']
      .map(name => [`monaco-editor/${name}?worker`, require.resolve(`monaco-editor/${name}`)]),
  ]);
  const prepared = new Map();
  try {
    for (const [source, entry] of entries) {
      const name = path.basename(entry).replace(/\.(ts|js)$/, '');
      const result = await build({ absWorkingDir: root, entryPoints: [entry],
        outfile: `${name}.js`, bundle: true, platform: 'browser', format: 'esm',
        target: 'es2022', minify: true, sourcemap: 'external', write: false,
      });
      const code = result.outputFiles.find(file => file.path.endsWith('.js'));
      const map = result.outputFiles.find(file => file.path.endsWith('.map'));
      if (!code || !map) throw Error(`Worker build did not produce code and a source map: ${entry}`);
      const hash = createHash('sha256').update(code.contents).digest('hex').slice(0, 12);
      prepared.set(source, { code: code.text, map: map.contents, fileName: `assets/${name}-${hash}.js` });
    }
  } finally { stop(); }
  console.info(`[build] Prepared ${prepared.size} workers sequentially.`);
  const prefix = '\0setdown-worker:';
  return {
    name: 'setdown-sequential-workers', apply: 'build', enforce: 'pre',
    resolveId(source) { if (prepared.has(source)) return prefix + source; },
    load(source) {
      if (!source.startsWith(prefix)) return;
      const { code, map, fileName } = prepared.get(source.slice(prefix.length));
      this.emitFile({ type: 'asset', fileName: `${fileName}.map`, source: map });
      const reference = this.emitFile({ type: 'asset', fileName,
        source: `${code}\n//# sourceMappingURL=${path.basename(fileName)}.map\n` });
      return `export default function WorkerWrapper(options) { return new Worker(import.meta.ROLLUP_FILE_URL_${reference}, { type: 'module', ...options }); }`;
    },
  };
}
