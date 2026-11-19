import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Which Python environments are on this computer is found out by Zed's own search, the one
// its environment picker shows (vendor/zed/crates/languages/src/python.rs,
// `PythonToolchainProvider::list`). That search is PET, the locator the two VS Code Python
// extensions use: pyenv, Poetry, Pipenv, Hatch, Pixi, Conda, uv, venv and the system's own.
// The language host answers it (`toolchains`); this file reads the answer and says which of
// the environments were made for one project. Which one is used stays Setdown's rule
// (`analysis-context.ts`): one environment of the project is used, several are asked about.
// Zed takes the first of its order without asking; that order starts with the same
// environments (`.venv` file, then `wr_distance`), so the two differ only where a project has
// several environments of its own.

export type FoundPython = {
  /** The interpreter. */
  path: string;
  /** Zed's line for it in the picker: "Python 3.12.3 (myapp-abc-py3.12; Poetry)". */
  name: string;
  /** PET's kind: "Poetry", "Pipenv", "Pyenv", "Pixi", "Hatch", "Conda", "Uv", "Venv", … */
  kind?: string;
  /** The folder the environment was made for, where the tool that made it records one (Poetry, Pipenv). */
  project?: string;
  /** The environment's own folder. */
  prefix?: string;
  /** The environment's name, where it has one (a Conda, pyenv or virtualenvwrapper environment). */
  environment?: string;
};

/** python.rs `is_python_env_global`: an interpreter installed for the whole computer, which belongs to no project. */
export const globalPythonKinds = ['Homebrew', 'Pyenv', 'GlobalPaths', 'MacPythonOrg', 'MacCommandLineTools', 'LinuxGlobal', 'MacXCode', 'WindowsStore', 'WindowsRegistry'];

/** The host's answer to `toolchains`, in Zed's order. Anything that is not an interpreter at an absolute path is left out. */
export function foundPythons(answer: unknown): FoundPython[] {
  const list = (answer as { toolchains?: unknown } | null)?.toolchains;
  if (!Array.isArray(list)) return [];
  const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
  const folder = (value: unknown) => { const found = text(value); return found && path.isAbsolute(found) ? found : undefined; };
  return list.slice(0, 200).flatMap(entry => {
    const item = entry && typeof entry === 'object' ? entry as { name?: unknown; path?: unknown; data?: unknown } : {};
    const data = item.data && typeof item.data === 'object' ? item.data as Record<string, unknown> : {};
    const file = folder(item.path);
    return file ? [{ path: file, name: text(item.name) ?? path.basename(file), kind: text(data.kind), project: folder(data.project), prefix: folder(data.prefix), environment: text(data.name) }] : [];
  });
}

const within = (root: string, folder: string | undefined) => { if (!folder) return false; const relative = path.relative(root, folder); return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); };

/** python.rs `get_worktree_venv_declaration`: a file `.venv` in the project names the
 * environment to use (virtualfish's auto-activation). A folder `.venv` names nothing. */
export function declaredPython(root: string): string | undefined {
  try { return readFileSync(path.join(root, '.venv'), 'utf8').split('\n', 1)[0].trim() || undefined; } catch { return undefined; }
}

/** PET's `is_virtualenv_dir`, which python.rs `get_venv_parent_dir` asks: the folder of the
 * programs has an activation script. A `pyvenv.cfg` says the same of one made without scripts. */
function virtualenv(programs: string): boolean {
  if (existsSync(path.join(path.dirname(programs), 'pyvenv.cfg'))) return true;
  try { return readdirSync(programs).some(name => /^activate(\.[a-z\d]+)?$/i.test(name)); } catch { return false; }
}

/** The environments Zed's order puts before every other: the one the project's `.venv` file
 * names, then (python.rs `wr_distance`) one whose project folder is inside the open folder,
 * where the project folder is what the tool that made it recorded (Poetry, Pipenv, Hatch), or
 * else the folder its virtualenv lies in. Two kinds lie in a project without being virtualenvs,
 * and Setdown counts them too: Pixi's `.pixi/envs/*` and a Conda environment made with
 * `--prefix`, which has no name. A Conda environment with a name belongs to its Conda, and an
 * interpreter of the whole computer (`is_python_env_global`) to nobody, wherever they lie:
 * with the home folder open, neither is the project's. */
export function belongsToProject(found: FoundPython, root: string, declared = declaredPython(root)): boolean {
  if (declared && found.environment === declared) return true;
  if (found.kind && globalPythonKinds.includes(found.kind)) return false;
  if (within(root, found.project)) return true;
  if (!within(root, pythonPrefix(found))) return false;
  return found.kind === 'Pixi' || (found.kind === 'Conda' ? !found.environment : virtualenv(path.dirname(found.path)));
}

/** The environment's folder, which names it: two programs in one folder (`python`, `python3`) are one environment. */
export const pythonPrefix = (found: Pick<FoundPython, 'path' | 'prefix'>) => found.prefix ?? path.dirname(path.dirname(found.path));

/** What the environment panel says an environment came from. */
export function pythonSource(found: FoundPython): string {
  const kinds: Record<string, string> = { Poetry: 'Poetry', Pipenv: 'Pipenv', Hatch: 'Hatch', Pixi: 'Pixi', Conda: 'Conda', Pyenv: 'pyenv', PyenvVirtualEnv: 'pyenv',
    Uv: 'uv', UvWorkspace: 'uv', Venv: 'venv', VirtualEnv: 'virtualenv', VirtualEnvWrapper: 'virtualenvwrapper', Homebrew: 'Homebrew', WinPython: 'WinPython' };
  return found.kind && kinds[found.kind] || (found.kind && globalPythonKinds.includes(found.kind) ? 'This computer' : 'Python environment');
}
