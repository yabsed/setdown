import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Direct File Viewer dependencies of the Office viewer; their runtime closure is bundled into dist/assets. */
export const OFFICE_VIEWER_PACKAGES = ['@file-viewer/web', '@file-viewer/renderer-word', '@file-viewer/renderer-spreadsheet',
  '@file-viewer/renderer-presentation', '@file-viewer/renderer-hangul'];
const NOTICE_FILE = /^(licen[cs]e|notice|third[_-]party)/i;
const BUNDLE_NOTICE_FILE = /third[_-]party|licenses/i;

function locate(name, from) {
  for (let directory = from; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(directory) === directory) return null;
  }
}

/** Installed runtime closure, by Node's own lookup order. Optional packages that are not installed are skipped. */
export function officeViewerClosure(root = process.cwd()) {
  const found = new Map();
  const visit = (name, from, optional) => {
    const directory = locate(name, from);
    if (!directory) { if (optional) return; throw new Error(`Office viewer dependency is not installed: ${name}`); }
    if (found.has(directory)) return;
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    found.set(directory, manifest);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, directory, false);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) visit(dependency, directory, true);
  };
  for (const name of OFFICE_VIEWER_PACKAGES) visit(name, root, false);
  return [...found].map(([directory, manifest]) => ({ directory, name: manifest.name, version: manifest.version,
    license: typeof manifest.license === 'string' ? manifest.license : 'see package' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Original license and notice files of every bundled Office viewer package, including the notices shipped beside their worker bundles. */
export function officeViewerNotices(root = process.cwd()) {
  const sections = ['Setdown Office viewer notices', '=============================', '',
    'The Office viewer bundles flyfish-dev/file-viewer and the packages below. Their original notices are reproduced unchanged.', ''];
  for (const item of officeViewerClosure(root)) {
    const files = readdirSync(item.directory).filter(file => NOTICE_FILE.test(file)).map(file => path.join(item.directory, file));
    const dist = path.join(item.directory, 'dist');
    if (existsSync(dist)) files.push(...readdirSync(dist).filter(file => BUNDLE_NOTICE_FILE.test(file) && /\.(txt|md)$/i.test(file)).map(file => path.join(dist, file)));
    sections.push(`=== ${item.name}@${item.version} (${item.license}) ===`, '');
    for (const file of files.sort()) sections.push(`--- ${item.name}@${item.version}: ${path.relative(item.directory, file)} ---`, readFileSync(file, 'utf8').trimEnd(), '');
  }
  return sections.join('\n') + '\n';
}
