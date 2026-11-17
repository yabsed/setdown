import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Type stubs for libraries that publish no type information, as VS Code's Python
// analysis ships them. src/main/language/python-library-stubs.ts decides per selected
// environment whether each one applies. A library is listed only after its stubs
// removed more false reports than they added on public notebooks; apps/notebook-benchmark
// measures that, and reports/notebook-lsp-corpus-2026-11-18 records the first run.
// The SymPy stubs of vendor/python-type-stubs changed nothing there and are left out.
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root = path.resolve(desktop, '../..');
const compat = path.join(desktop, 'src/main/language/upstream/numpy-typing-compat');
const sources = [
  { library: 'pandas', distribution: 'pandas-stubs',
    packages: [{ submodule: 'vendor/pandas-stubs', directory: 'pandas-stubs', license: 'PANDAS-STUBS-LICENSE.txt' }] },
  { library: 'django', distribution: 'django-stubs',
    packages: [{ submodule: 'vendor/django-stubs', directory: 'django-stubs', license: 'DJANGO-STUBS-LICENSE.txt', licenseFile: 'LICENSE.md' },
      { submodule: 'vendor/django-stubs', directory: 'ext/django_stubs_ext', license: 'DJANGO-STUBS-LICENSE.txt', licenseFile: 'LICENSE.md' }] },
  // scipy-stubs reads NumPy's types through optype: Python source in 3.12 syntax, whose
  // own dependency is published once per NumPy minor version.
  { library: 'scipy', distribution: 'scipy-stubs', python: '3.12', numpy: ['2.0', '2.1', '2.2', '2.3', '2.4', '2.5'],
    packages: [{ submodule: 'vendor/scipy-stubs', directory: 'scipy-stubs', license: 'SCIPY-STUBS-LICENSE.txt' },
      { submodule: 'vendor/optype', directory: 'optype', license: 'OPTYPE-LICENSE.txt' }] },
  // Microsoft maintains these for Pylance, which ships them. The repository publishes
  // no releases, so the date of the pinned commit stands in for a version.
  { library: 'sklearn', distribution: 'python-type-stubs', revision: true,
    packages: [{ submodule: 'vendor/python-type-stubs', directory: 'stubs/sklearn', license: 'PYTHON-TYPE-STUBS-LICENSE.txt' }] },
];

/** Writes one folder per library and their catalog to `output`, and each license to `licenses`. */
export async function buildPythonStubs(output = path.join(desktop, 'dist-electron/python-stubs'), licenses = path.join(desktop, 'dist-electron')) {
  await rm(output, { recursive: true, force: true });
  await mkdir(licenses, { recursive: true });
  const catalog = {};
  for (const source of sources) {
    // One folder per library, so each can be offered or withheld on its own.
    await mkdir(path.join(output, source.library), { recursive: true });
    for (const item of source.packages) {
      const checkout = path.join(root, item.submodule), files = path.join(checkout, item.directory);
      if (!existsSync(files)) execFileSync('git', ['submodule', 'update', '--init', item.submodule], { cwd: root, stdio: 'inherit' });
      await cp(files, path.join(output, source.library, path.basename(item.directory)), { recursive: true });
      await copyFile(path.join(checkout, item.licenseFile ?? 'LICENSE'), path.join(licenses, item.license));
    }
    const first = path.join(root, source.packages[0].submodule);
    const version = source.revision ? execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: first, encoding: 'utf8' }).trim()
      : /^version = "([^"]+)"/m.exec(await readFile(path.join(first, 'pyproject.toml'), 'utf8'))?.[1];
    if (!version) throw Error(`${source.packages[0].submodule} does not declare a version.`);
    catalog[source.library] = { distribution: source.distribution, version, paths: [source.library], python: source.python,
      numpy: source.numpy && Object.fromEntries(source.numpy.map(minor => [minor, `numpy-typing-compat/${minor}`])) };
    for (const minor of source.numpy ?? []) await cp(path.join(compat, minor), path.join(output, 'numpy-typing-compat', minor), { recursive: true });
  }
  await copyFile(path.join(compat, 'LICENSE'), path.join(licenses, 'NUMPY-TYPING-COMPAT-LICENSE.txt'));
  await writeFile(path.join(output, 'stubs.json'), JSON.stringify(catalog, null, 2) + '\n');
}
