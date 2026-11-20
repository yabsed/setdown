import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { setting } from './extension-rules';

// A Python project names folders to import from in a `.env` file: `PYTHONPATH=src:../shared`.
// Pyright's own VS Code client does not read that file. Microsoft's Python extension does: it
// parses the file named by `python.envFile`, and tells its language server what `PYTHONPATH` came
// out. The rules in this file are carried over from:
//   vendor/vscode-python/package.json                                              `python.envFile` and its default
//   vendor/vscode-python/src/client/common/variables/environment.ts                `parseEnvFile`, `parseEnvLine`, `substituteEnvVars`, `appendPythonPath`
//   vendor/vscode-python/src/client/common/variables/environmentVariablesProvider.ts  `getEnvFile`, the file watcher, `getMergedEnvironmentVariables`
//   vendor/vscode-python/src/client/common/variables/systemVariables.ts            the `${…}` names of the setting
//   vendor/vscode-python/src/client/activation/common/analysisOptions.ts           `onEnvVarChange`: the wait before the file is read again
//   vendor/vscode-python/src/client/activation/jedi/manager.ts                     `restartLanguageServerDebounced`: the wait before the restart
//   vendor/vscode-python/src/test/common/variables/envVarsService.unit.test.ts     what the parser has to answer
//
// The extension hands the result to Pylance as `_envPYTHONPATH` in the `python` settings
// (`activation/languageClientMiddlewareBase.ts`). Pyright reads no such setting. What makes Pyright
// look in more folders is one of two things (vendor/pyright/packages/pyright-internal/src/):
//   `python.analysis.extraPaths`   read in `pyrightServer.ts` `getSettings`. Searched straight after the
//                                  project folder and before the standard library (`analyzer/importResolver.ts`),
//                                  which is where Python itself puts `PYTHONPATH`. Read again when the
//                                  settings change. Ignored when `pyrightconfig.json` or `pyproject.toml`
//                                  sets `extraPaths` (`analyzer/service.ts`: `if (!configOptions.defaultExtraPaths)`).
//   `PYTHONPATH` of the server process   Pyright asks the interpreter for `sys.path` with the environment it
//                                  was started with and the project folder as working directory
//                                  (`common/fullAccessHost.ts` `_getSearchPathResultFromInterpreter`). Searched
//                                  after the standard library, as installed packages are. The environment is
//                                  the one of the running process, so a change needs the server started again.

type Settings = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
const own = (values: Environment, name: string): string | undefined => Object.hasOwn(values, name) ? values[name] : undefined;

/** `package.json`, `contributes.configuration.properties`. */
export const pythonEnvFileSetting = 'python.envFile';
export const pythonEnvFileDefault = '${workspaceFolder}/.env';
/** `analysisOptions.ts` `onEnvVarChange`, `@debounceSync(1000)`: how long after the last change of
 * the file the extension reads it again and compares `PYTHONPATH` with what the server was started with. */
export const pythonEnvChangeDelay = 1000;
/** `jedi/manager.ts` `restartLanguageServerDebounced`, `@debounceSync(1000)`: how long after that
 * comparison found a difference the extension starts the server again. */
export const pythonEnvRestartDelay = 1000;

/** The file `python.envFile` names for the project in `root`, or `undefined` when the setting
 * names none. This is the one file the extension reads and watches for a change, a creation and
 * a removal (`environmentVariablesProvider.ts` `getEnvFile`, `createFileWatcher`).
 *
 * The names in `${…}` are those of `systemVariables.ts` that mean something without an open
 * document: the project folder, its name, and a variable of the environment. An environment
 * variable that is not set becomes nothing; any other name it does not know stays as written.
 *
 * A path that is not absolute is read from the project folder. The extension reads it from the
 * folder VS Code was started in, which says nothing about the project. */
export function pythonEnvFile(root: string, settings?: Settings, env: Environment = process.env): string | undefined {
  const written = setting(settings, pythonEnvFileSetting);
  if (written !== undefined && typeof written !== 'string') return undefined;
  const folder = path.basename(root);
  const names: Environment = { workspaceFolder: root, workspaceRoot: root, cwd: root, workspaceFolderBasename: folder, workspaceRootFolderName: folder,
    [`workspaceFolder:${folder}`]: root };
  // `__resolveString`: `/\$\{(.*?)\}/g`, and `match.indexOf('env.') > 0 || match.indexOf('env:') > 0` for a name it does not know.
  const file = (written ?? pythonEnvFileDefault).replace(/\$\{(.*?)\}/g, (match: string, name: string) =>
    own(names, name) ?? (/^env[:.]/.test(name) ? own(env, name.slice(4)) : undefined) ?? (match.includes('env.') || match.includes('env:') ? '' : match));
  return file && !file.includes('\0') ? path.resolve(root, file) : undefined;
}

/** `parseEnvLine`: a name, `=`, a value. Any other line is skipped, a comment among them. */
const linePattern = /^\s*(_*[a-zA-Z]\w*)\s*=\s*(.*?)?\s*$/;
/** `SUBST_REGEX`. The second group catches what makes a reference one the extension does not replace. */
const substitutionPattern = /\${([a-zA-Z]\w*)?([^}\w].*)?}/g;
/** The longest value a reference to other variables may build. Windows allows a variable 32,767 characters. */
const longestValue = 32_767;

function parseLine(line: string): [string, string] | undefined {
  const match = linePattern.exec(line);
  if (!match) return undefined;
  let value = match[2] ?? '';
  // Outer quotation marks of one kind are removed, and only then is `\n` a line break.
  if ((value[0] === "'" && value[value.length - 1] === "'") || (value[0] === '"' && value[value.length - 1] === '"'))
    value = value.substring(1, value.length - 1).replace(/\\n/gm, '\n');
  return [match[1], value];
}

/** `substituteEnvVars`: `${NAME}` is the variable written earlier in the file, else the one of
 * `base`, else nothing. One reference the extension does not accept (`${}`, `${A+B}`, a reference
 * inside a reference) leaves the whole value as written. `\${` is not a reference, and `\$` is `$`. */
function substitute(value: string, earlier: Map<string, string>, base: Environment): string {
  let invalid = false, length = value.length;
  const replaced = value.replace(substitutionPattern, (match: string, name: string | undefined, bogus: string | undefined, offset: number, whole: string) => {
    if (offset > 0 && whole[offset - 1] === '\\') return match;
    if (bogus || !name) { invalid = true; return match; }
    const found = earlier.get(name) || own(base, name) || '';
    length += found.length - match.length;
    // Not in the extension: a file whose lines each double a variable would otherwise fill the memory.
    if (length > longestValue) { invalid = true; return match; }
    return found;
  });
  return (invalid ? value : replaced).replace(/\\\$/g, '$');
}

/** `parseEnvFile`: the variables a `.env` file sets, in the order of the file. `base` is the
 * environment a reference falls back on; the extension passes its own process environment.
 *
 * It is the extension's reading and not a shell's: one variable on a line, no `export`, no value
 * over several lines, and `#` starts a comment only at the start of a line. */
export function parseEnvFile(text: string, base: Environment = {}): Record<string, string> {
  const variables = new Map<string, string>();
  for (const line of text.split('\n')) {
    const parsed = parseLine(line);
    if (parsed) variables.set(parsed[0], substitute(parsed[1], variables, base));
  }
  return Object.fromEntries(variables);
}

/** `parseFileSync`: the variables of `file`. None when no file is named, when it is missing,
 * cannot be read or is empty; also when it is larger than 1 MiB. */
export function readEnvFile(file: string | undefined, base: Environment = {}): Record<string, string> {
  if (!file) return {};
  try {
    const status = statSync(file);
    return status.isFile() && status.size <= 1024 * 1024 ? parseEnvFile(readFileSync(file, 'utf8'), base) : {};
  } catch { return {}; }
}

/** What a project's `.env` file adds to where Pyright looks for imports. */
export type EnvImportRoots = {
  /** Added to `python.analysis.extraPaths`, after what the person wrote there. */
  extraPaths: string[];
  /** Added to the environment the server is started with. Empty when the file sets no `PYTHONPATH`. */
  env: { PYTHONPATH?: string };
};

/** The folders `PYTHONPATH` of a parsed `.env` file names, for the project in `root`.
 *
 * Python reads an entry that is not absolute from its working directory, and an empty entry as
 * the working directory itself. Pyright starts the interpreter in the project folder, so every
 * entry becomes a path from `root`. The same folder is named once; at most 256 are kept.
 *
 * `inherited` is the `PYTHONPATH` the server would be started with anyway. It follows the file's
 * entries, as in `getMergedEnvironmentVariables` (`appendPythonPath`). */
export function envImportRoots(variables: Record<string, string>, root: string, inherited?: string): EnvImportRoots {
  const written = own(variables, 'PYTHONPATH');
  if (typeof written !== 'string' || !written) return { extraPaths: [], env: {} };
  const extraPaths = [...new Set(written.split(path.delimiter).filter(entry => !entry.includes('\0')).map(entry => path.resolve(root, entry)))].slice(0, 256);
  const rest = typeof inherited === 'string' ? inherited.trim() : '';
  return { extraPaths, env: { PYTHONPATH: [...extraPaths, ...(rest ? [rest] : [])].join(path.delimiter) } };
}
