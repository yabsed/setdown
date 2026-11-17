import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

/** Stub packages shipped for libraries that publish no type information, as VS
 * Code's Python analysis ships them. Without stubs the analyzer reads a library's
 * internal annotations, which are not written for its users: pandas, for example,
 * declares `Series.unique()` as possibly returning an extension array, and SciPy's
 * result objects lose their fields, so correct code is reported.
 *
 * Whatever the selected environment or the project already provides wins: types
 * published by the library, a stub package installed next to it, or the project's
 * `typings` folder. scripts/build-python-stubs.mjs owns the shipped catalog. */
type Stubs = { distribution: string; version: string; paths: string[]; python?: string; numpy?: Record<string, string> };
/** The selected interpreter's version (`3.13`) and `sys.path`. */
export type PythonSearch = { version?: string; paths: string[] };
export type LibraryStubs = { paths: string[]; evidence: string[] };

const bundledDirectory = () => path.join(__dirname, 'python-stubs').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
const isDirectory = (file: string) => { try { return statSync(file).isDirectory(); } catch { return false; } };
const minor = (version?: string) => /^(\d+)\.(\d+)/.exec(version ?? '')?.slice(1, 3).map(Number);

function installedVersion(paths: string[], distribution: string): string | undefined {
  const name = new RegExp(`^${distribution}-(\\d+\\.\\d+[^-]*)\\.dist-info$`, 'i');
  for (const entry of paths) {
    let names: string[] = [];
    try { names = readdirSync(entry); } catch { /* Not every search path is readable. */ }
    for (const candidate of names) { const match = name.exec(candidate); if (match) return match[1]; }
  }
}

/** The folders to add for one library, or why its stubs cannot describe this environment. */
function applicable(stubs: Stubs, search: PythonSearch): { paths: string[]; unmet?: string } {
  const python = minor(search.version), needed = minor(stubs.python);
  if (python && needed && (python[0] < needed[0] || (python[0] === needed[0] && python[1] < needed[1])))
    return { paths: [], unmet: `needs Python ${stubs.python} or newer; the selected environment is ${search.version}` };
  if (!stubs.numpy) return { paths: stubs.paths };
  const numpy = minor(installedVersion(search.paths, 'numpy'))?.join('.'), supported = Object.keys(stubs.numpy);
  return numpy && stubs.numpy[numpy] ? { paths: [...stubs.paths, stubs.numpy[numpy]] }
    : { paths: [], unmet: `needs NumPy ${supported[0]}–${supported.at(-1)}; the selected environment has ${numpy ? `NumPy ${numpy}` : 'none'}` };
}

export function libraryStubs(root: string, search: PythonSearch, bundled = bundledDirectory()): LibraryStubs {
  const result: LibraryStubs = { paths: [], evidence: [] };
  let catalog: Record<string, Stubs>;
  try { catalog = JSON.parse(readFileSync(path.join(bundled, 'stubs.json'), 'utf8')); } catch { return result; }
  for (const [library, stubs] of Object.entries(catalog)) {
    const installed = search.paths.find(entry => isDirectory(path.join(entry, library)));
    if (!installed) continue;
    const from = (source: string) => result.evidence.push(`Library types (${library}): ${source}`);
    const shipped = `${stubs.distribution} ${stubs.version} bundled with Setdown`;
    if (existsSync(path.join(installed, library, 'py.typed'))) from('published by the installed library');
    else if (search.paths.some(entry => isDirectory(path.join(entry, `${library}-stubs`)))) from(`${stubs.distribution} installed in the selected environment`);
    else if ([library, `${library}-stubs`].some(name => isDirectory(path.join(root, 'typings', name)))) from('this project’s typings folder');
    else {
      const { paths, unmet } = applicable(stubs, search);
      result.paths.push(...paths.map(item => path.join(bundled, item)));
      from(unmet ? `inferred from the library’s source code; ${shipped} ${unmet}` : `${shipped}, because the installed library publishes none`);
    }
  }
  return result;
}
