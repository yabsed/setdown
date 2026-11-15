import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Direct File Viewer dependencies of the Office viewer; their runtime closure is bundled into dist/assets. */
export const OFFICE_VIEWER_PACKAGES = ['@file-viewer/web', '@file-viewer/renderer-word', '@file-viewer/renderer-spreadsheet',
  '@file-viewer/renderer-presentation', '@file-viewer/renderer-hangul'];
/** The Word editor: the Apache-2.0 engine and its substitute fonts. The engine's separately licensed Pro packages are never installed or bundled. */
export const WORD_EDITOR_PACKAGES = ['@docx-editor.dev/core', '@docx-editor.dev/fonts'];
const NOTICE_FILE = /^(licen[cs]es?|notice|third[_-]party)/i;
const BUNDLE_NOTICE_FILE = /third[_-]party|licenses/i;

function locate(name, from) {
  for (let directory = from; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(directory) === directory) return null;
  }
}

/** Installed runtime closure, by Node's own lookup order. Optional packages that are not installed are skipped. */
export function officeViewerClosure(root = process.cwd(), packages = OFFICE_VIEWER_PACKAGES) {
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
  for (const name of packages) visit(name, root, false);
  return [...found].map(([directory, manifest]) => ({ directory, name: manifest.name, version: manifest.version,
    license: typeof manifest.license === 'string' ? manifest.license : 'see package' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
export const wordEditorClosure = (root = process.cwd()) => officeViewerClosure(root, WORD_EDITOR_PACKAGES);

/** Notice files of one package: those at its root, everything inside a `licenses/` folder, and the notices shipped beside its bundles. */
function noticeFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory).filter(file => NOTICE_FILE.test(file))) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) files.push(...readdirSync(target).map(file => path.join(target, file)).filter(file => statSync(file).isFile()));
    else files.push(target);
  }
  const dist = path.join(directory, 'dist');
  if (existsSync(dist)) files.push(...readdirSync(dist).filter(file => BUNDLE_NOTICE_FILE.test(file) && /\.(txt|md)$/i.test(file)).map(file => path.join(dist, file)));
  return files.sort();
}
function sections(closure) {
  const lines = [];
  for (const item of closure) {
    lines.push(`=== ${item.name}@${item.version} (${item.license}) ===`, '');
    for (const file of noticeFiles(item.directory)) lines.push(`--- ${item.name}@${item.version}: ${path.relative(item.directory, file)} ---`, readFileSync(file, 'utf8').trimEnd(), '');
  }
  return lines;
}

/** Original license and notice files of every bundled Office viewer and Word editor package, including the notices shipped beside their worker bundles and font files. */
export function officeViewerNotices(root = process.cwd()) {
  return ['Setdown Office viewer notices', '=============================', '',
    'The Office viewer bundles flyfish-dev/file-viewer and the packages below. Their original notices are reproduced unchanged.', '',
    ...sections(officeViewerClosure(root)),
    'Setdown Word editor notices', '===========================', '',
    'The Word (.docx) editor bundles eigenpal/docx-editor (@docx-editor.dev/core, Apache-2.0), its substitute fonts and the packages below.',
    'Only the Apache-2.0 packages are used; the EigenPal Pro packages are not part of Setdown. Their original notices are reproduced unchanged.', '',
    ...sections(wordEditorClosure(root))].join('\n') + '\n';
}
