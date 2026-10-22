import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = path.resolve('../..');
const hop = path.join(root, 'vendor/hop/apps/studio-host');
const upstream = path.join(root, 'vendor/rhwp/rhwp-studio/src');
const output = path.resolve('dist-electron/hwp');
for (const [module, file] of [['hop', 'apps/studio-host/index.html'], ['rhwp', 'rhwp-studio/src/core/wasm-bridge.ts']]) {
  if (!await access(path.join(root, 'vendor', module, file)).then(() => true, () => false))
    execFileSync('git', ['submodule', 'update', '--init', `vendor/${module}`], { cwd: root, stdio: 'inherit' });
}
const wasm = path.join(hop, 'vendor/rhwp-core');
await mkdir(output, { recursive: true });
const provenance = JSON.parse(await readFile(path.join(wasm, 'PROVENANCE.json'), 'utf8'));
if (provenance.commit !== '1a76570e833917d15817415a53c09ad61ab3203f') throw Error('Unexpected RHWP version. Review the pinned provenance.');
for (const [name, artifact] of Object.entries(provenance.artifacts)) {
  const bytes = await readFile(path.join(wasm, name));
  if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
    throw Error(`RHWP artifact failed provenance verification: ${name}`);
}
const alias = {
  '@/styles/about-dialog.css': path.join(hop, 'src/styles/about-dialog.css'),
  '@/styles/home-screen.css': path.join(hop, 'src/styles/home-screen.css'),
  '@/styles/custom-select.css': path.join(hop, 'src/styles/custom-select.css'),
  '@/styles/update-notice.css': path.join(hop, 'src/styles/update-notice.css'),
  '@/styles/recent-documents-dialog.css': path.join(hop, 'src/styles/recent-documents-dialog.css'),
  '@/command/commands/file': path.resolve('hwp-runtime/commands.ts'),
  '@/core/font-loader': path.resolve('hwp-runtime/fonts.ts'),
  '@/upstream': path.join(hop, 'src/upstream'),
  '@hop': path.join(hop, 'src'), '@upstream': upstream, '@': upstream,
  '@wasm/rhwp.js': path.join(wasm, 'rhwp.js'),
};
const define = { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.BASE_URL': '"/"',
  __APP_VERSION__: '"0.8.7"', __HOP_VERSION__: '"Setdown"' };
await build({ entryPoints: ['hwp-runtime/main.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'chrome140',
  outfile: path.join(output, 'main.js'), alias, define, sourcemap: true, loader: { '.wasm': 'file' } });
await build({ entryPoints: [path.join(hop, 'src/style.css')], bundle: true, outfile: path.join(output, 'main.css'),
  alias, loader: { '.png': 'file', '.svg': 'file', '.woff2': 'file' }, external: ['/images/*', '/fonts/*'] });
let html = await readFile(path.join(hop, 'index.html'), 'utf8');
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<title>.*?<\/title>/, '<title>Setdown HWP</title>')
  .replace('</head>', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'"><link rel="stylesheet" href="/main.css"></head>`)
  .replace('</body>', '<script type="module" src="/main.js"></script></body>');
await writeFile(path.join(output, 'index.html'), html);
await cp(path.join(wasm, 'rhwp_bg.wasm'), path.join(output, 'rhwp_bg.wasm'));
// Use the same complete blank document template as RHWP's createBlankDocument().
await cp(path.join(root, 'vendor/rhwp/saved/blank2010.hwp'), path.join(output, 'blank.hwp'));
// Upstream's blank_hwpx fixture contains sample text. Export the actual empty
// HWP template with the pinned engine, and validate the generated container.
const core = await import(pathToFileURL(path.join(wasm, 'rhwp.js')).href);
core.initSync({ module: await readFile(path.join(wasm, 'rhwp_bg.wasm')) });
const blank = new core.HwpDocument(new Uint8Array(await readFile(path.join(output, 'blank.hwp'))));
try {
  const exported = blank.exportHwpxWithReport();
  try {
    if (JSON.parse(exported.contentLoss()).count !== 0) throw Error('HWPX template export reported content loss.');
    const bytes = exported.takeBytes();
    const check = new core.HwpDocument(bytes);
    try {
      if (JSON.parse(check.getTextFileText()) !== '') throw Error('Generated HWPX template is not empty.');
    } finally { check.free(); }
    await writeFile(path.join(output, 'blank.hwpx'), bytes);
  } finally { exported.free(); }
} finally { blank.free(); }
await cp(path.join(hop, 'public/images'), path.join(output, 'images'), { recursive: true });
await rm(path.join(output, 'fonts'), { recursive: true, force: true });
await cp(path.join(root, 'vendor/hop/assets/fonts'), path.join(output, 'fonts'), { recursive: true,
  filter: file => !/^(Cafe24|Happiness)/.test(path.basename(file)) });
await cp('hwp-runtime/FONT-NOTICES.txt', path.join(output, 'fonts/FONT-NOTICES.txt'));
await cp(path.join(root, 'vendor/hop/LICENSE'), path.join(output, 'HOP-LICENSE'));
await cp(path.join(root, 'vendor/rhwp/LICENSE'), path.join(output, 'RHWP-LICENSE'));
await cp(path.join(wasm, 'PROVENANCE.json'), path.join(output, 'PROVENANCE.json'));

await cp(path.join(root, 'vendor/rhwp/THIRD_PARTY_LICENSES.md'), path.join(output, 'THIRD_PARTY_LICENSES.md'));
