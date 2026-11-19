import os from 'node:os';
import path from 'node:path';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import type { ServerLaunch } from './server-session';

// The rules in this file are carried over from the VS Code Java extension and the
// package it finds JDKs with. Each one names the file it came from, so a newer
// `vendor/vscode-java` can be compared against it:
//   vendor/vscode-java/src/requirements.ts   which JDK runs jdt.ls, and the project default
//   vendor/vscode-java/src/jdkUtils.ts       what counts as a JDK, and the order of preference
//   vendor/vscode-java/src/utils.ts          the JDK list a project may choose from
//   jdk-utils 0.6.0 (the version vscode-java locks), dist/index.js and dist/from/*.js

export type JavaHome = { home: string; major: number };
/** Where a JDK was found, in jdk-utils' names. The last three are places only Setdown looks in. */
export type JavaSource = 'JDK_HOME' | 'JAVA_HOME' | 'PATH' | 'SDKMAN' | 'jEnv' | 'jabba' | 'JBang' | 'asdf' | 'Gradle' | 'mise' | 'IntelliJ' | 'Maven';
export type InstalledJava = JavaHome & { sources: JavaSource[] };
const javaBinary = process.platform === 'win32' ? 'java.exe' : 'java';

/** A JDK states its version in its `release` file. No candidate is executed, so a home
 * without that file is not listed; jdk-utils would run its `java -version` instead. */
export async function javaHome(home: string): Promise<JavaHome | undefined> {
  try {
    const actual = await realpath(home);
    if (!(await stat(path.join(actual, 'bin', javaBinary))).isFile() || (await stat(path.join(actual, 'release'))).size > 64 * 1024) return undefined;
    const version = /^JAVA_VERSION="?([^"\r\n]+)/m.exec(await readFile(path.join(actual, 'release'), 'utf8'))?.[1];
    const parts = version?.split(/[._+-]/).map(Number) ?? [];
    const major = parts[0] === 1 ? parts[1] : parts[0];
    return Number.isSafeInteger(major) && major > 0 ? { home: actual, major } : undefined;
  } catch { return undefined; }
}

/** The JDK a launch would use by default: `JAVA_HOME`, then the first `java` on PATH. */
export async function defaultJava(env: NodeJS.ProcessEnv): Promise<JavaHome | undefined> {
  if (env.JAVA_HOME && path.isAbsolute(env.JAVA_HOME)) { const found = await javaHome(env.JAVA_HOME); if (found) return found; }
  for (const directory of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(entry => path.isAbsolute(entry))) {
    try { const found = await javaHome(path.dirname(path.dirname(await realpath(path.join(directory, javaBinary))))); if (found) return found; }
    catch { /* No java in this directory. */ }
  }
  return undefined;
}

/** `folders` hold one JDK per entry. `homebrew` holds one link per formula, of which only
 * those named like a JDK are followed. */
export type JavaPlaces = { folders: string[]; homebrew: string[] };

/** Where operating-system packages and vendor installers put JDKs: jdk-utils `from/linux.js`,
 * `from/macOS.js`, `from/windows.js` and `from/homebrew.js`, and after them the places Setdown
 * already looked in. `/usr/libexec/java_home -V` is not run; it lists the same macOS folders. */
export function systemJavaPlaces(env: NodeJS.ProcessEnv = process.env): JavaPlaces {
  if (process.platform === 'darwin') return { folders: ['/Library/Java/JavaVirtualMachines', path.join(env.HOME || os.homedir(), 'Library/Java/JavaVirtualMachines')],
    homebrew: [process.arch.startsWith('arm') ? '/opt/homebrew/opt' : '/usr/local/opt'] };
  if (process.platform === 'win32') {
    const roots = [...new Set([env.ProgramW6432, env.ProgramFiles, env.LOCALAPPDATA, path.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local'), env['ProgramFiles(x86)']])].filter((root): root is string => !!root);
    const vendors = ['Eclipse Foundation', 'Eclipse Adoptium', 'Java', 'Amazon Corretto', 'Microsoft', path.join('SapMachine', 'JDK'), 'Zulu', 'BellSoft'];
    return { folders: roots.flatMap(root => vendors.map(vendor => path.join(root, vendor))), homebrew: [] };
  }
  return { folders: ['/usr/lib/jvm', '/usr/java', '/usr/lib64/jvm', '/opt/java', '/opt/jdk'], homebrew: ['/home/linuxbrew/.linuxbrew/opt'] };
}

/** jdk-utils `getRealHome`: the home a `bin/java` really lives in. Homebrew and the
 * alternatives system link the program and not its folder. */
async function linkedJavaHome(folder: string): Promise<string | undefined> {
  try { return path.dirname(path.dirname(await realpath(path.join(folder, 'bin', javaBinary)))); } catch { return undefined; }
}

/** vscode-java `listJdks`: only a folder with the Java class library is a Java home. */
async function hasClassLibrary(home: string): Promise<boolean> {
  for (const library of ['lib/jrt-fs.jar', 'lib/rt.jar', 'jre/lib/rt.jar']) {
    try { await access(path.join(home, library)); return true; } catch { /* Try the next layout. */ }
  }
  return false;
}

/** Every JDK on this computer, in the order jdk-utils `findRuntimes` meets them, each with
 * the places it was found in. Links are followed, so one JDK is listed once. */
export async function installedJava(env: NodeJS.ProcessEnv, places: JavaPlaces = systemJavaPlaces(env), home = env.HOME || env.USERPROFILE || os.homedir()): Promise<InstalledJava[]> {
  const found = new Map<string, InstalledJava>();
  const add = async (candidate: string | undefined, source?: JavaSource): Promise<boolean> => {
    const java = candidate && path.isAbsolute(candidate) ? await javaHome(candidate) : undefined;
    if (!java || !await hasClassLibrary(java.home)) return false;
    const known = found.get(java.home) ?? { ...java, sources: [] };
    if (source && !known.sources.includes(source)) known.sources.push(source);
    found.set(java.home, known);
    return true;
  };
  // By name, so two JDKs of one release in one place are always met in the same order.
  const entries = async (parent: string, keep: (name: string) => boolean = () => true) =>
    (await readdir(parent).catch(() => [] as string[])).filter(keep).sort().slice(0, 200).map(name => path.join(parent, name));
  // A macOS bundle keeps its home two folders down.
  const within = async (parent: string, source?: JavaSource) => {
    for (const entry of await entries(parent)) { await add(entry, source); await add(path.join(entry, 'Contents', 'Home'), source); }
  };
  const named = async (value: string | undefined, source: JavaSource) => {
    const folder = value?.replace(/[\\/]$/, '');
    if (folder && path.isAbsolute(folder) && !await add(folder, source)) await add(await linkedJavaHome(folder), source);
  };
  const tilde = (entry: string) => entry.startsWith('~') ? path.join(home, entry.slice(1)) : entry;

  await within(path.join(env.SDKMAN_DIR || path.join(home, '.sdkman'), 'candidates', 'java'), 'SDKMAN');
  for (const folder of places.folders) await within(folder);
  for (const opt of places.homebrew) for (const link of await entries(opt, name => /jdk|java/i.test(name))) await add(await linkedJavaHome(link));
  await named(env.JDK_HOME, 'JDK_HOME');
  await named(env.JAVA_HOME, 'JAVA_HOME');
  for (const entry of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean).map(tilde).filter(entry => path.isAbsolute(entry))) {
    try { await add(path.dirname(path.dirname(await realpath(path.join(entry, javaBinary)))), 'PATH'); } catch { /* No java in this directory. */ }
  }
  await within(path.join(home, '.jenv', 'versions'), 'jEnv');
  await within(path.join(home, '.jabba', 'jdk'), 'jabba');
  await within(path.join(env.JBANG_DIR || path.join(home, '.jbang'), 'cache', 'jdks'), 'JBang');
  await within(path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'installs', 'java'), 'asdf');
  // Gradle unpacked a toolchain one folder below its name, and newer releases into that folder itself.
  for (const distribution of await entries(path.join(env.GRADLE_USER_HOME || path.join(home, '.gradle'), 'jdks'))) { await add(distribution, 'Gradle'); await within(distribution, 'Gradle'); }
  // Not in jdk-utils 0.6.0. They come last, so they never displace a JDK vscode-java would have chosen.
  await within(path.join(home, '.local', 'share', 'mise', 'installs', 'java'), 'mise');
  await within(path.join(home, '.jdks'), 'IntelliJ');
  await within(path.join(home, '.m2', 'jdks'), 'Maven');
  return [...found.values()];
}

/** vscode-java `sortJdksBySource`: the environment's own choice, then a version manager,
 * then a system folder, then anything else such as a toolchain Gradle downloaded. */
function sourceRank(java: InstalledJava): number {
  const environment = (['JDK_HOME', 'JAVA_HOME', 'PATH'] as JavaSource[]).findIndex(source => java.sources.includes(source));
  if (environment >= 0) return environment;
  if (java.sources.some(source => ['SDKMAN', 'jEnv', 'jabba', 'asdf'].includes(source))) return 4;
  return java.sources.length ? 6 : 5;
}

/** vscode-java sorts by version (`sortJdksByVersion`) and then, keeping that order among
 * equals, by source: the newest JDK of the best place comes first. */
export function preferredJava<T extends InstalledJava>(installed: T[]): T[] {
  return [...installed].sort((a, b) => b.major - a.major).sort((a, b) => sourceRank(a) - sourceRank(b));
}

/** jdt.ls runs on this Java or newer: `REQUIRED_JDK_VERSION` in vscode-java's requirements.ts.
 * The Zed Java extension checks the same number before it starts jdt.ls. */
export const jdtlsJava = 25;
/** The runtime names jdt.ls accepts, from the `java.configuration.runtimes` name list in
 * vscode-java's package.json. Another name is answered with "Invalid runtime". */
export const javaRuntimeNames = { oldest: 8, newest: 27 };

/** vscode-java `addAutoDetectedJdks`: an execution environment is named after the release. */
export function javaRuntimeName(major: number): string {
  return major <= 5 ? `J2SE-1.${major}` : major <= 8 ? `JavaSE-1.${major}` : `JavaSE-${major}`;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** vscode-java `addAutoDetectedJdks`: the person's own runtimes stay as written, and each
 * installed JDK whose release they did not name is added, the preferred one of a release only. */
export function projectRuntimes(configured: unknown, installed: InstalledJava[]): Record<string, unknown>[] {
  const runtimes = (Array.isArray(configured) ? configured : []).filter(runtime => runtime && typeof runtime === 'object').map(runtime => ({ ...runtime as Record<string, unknown> }));
  const names = new Set(runtimes.map(runtime => runtime.name).filter(Boolean));
  for (const java of preferredJava(installed)) {
    const name = javaRuntimeName(java.major);
    if (names.has(name) || java.major < javaRuntimeNames.oldest || java.major > javaRuntimeNames.newest) continue;
    runtimes.push({ name, path: java.home });
    names.add(name);
  }
  return runtimes;
}

/** eclipse.jdt.ls's launcher refuses an older JVM. Its own check states the minimum,
 * so a later release that raises it needs no change here. */
export async function javaRequirement(launch: Pick<ServerLaunch, 'executable'>): Promise<number | undefined> {
  if (!/^jdtls(?:\.py)?$/i.test(path.basename(launch.executable))) return undefined;
  try {
    const script = path.join(path.dirname(await realpath(launch.executable)), 'jdtls.py');
    if ((await stat(script)).size > 256 * 1024) return undefined;
    const minimum = Number(/java_major_version\s*<\s*(\d+)/.exec(await readFile(script, 'utf8'))?.[1]);
    return Number.isSafeInteger(minimum) && minimum > 0 ? minimum : undefined;
  } catch { return undefined; }
}

/** jdt.ls, under any of the names a tool definition carries it by. */
export function isJdtls(definition: { id: string; provenance?: { profile?: string }; launch: { kind: string; command?: string } }): boolean {
  return [definition.id, definition.provenance?.profile, definition.launch.kind === 'native' ? definition.launch.command : undefined].includes('jdtls');
}

export type JavaPlan = {
  /** The JDK that runs the tool. Absent when none on this computer is new enough, or when
   * the person named a folder that is not a JDK; the tool then states the problem itself. */
  tooling?: JavaHome;
  /** The JDK a project uses when its build names none. */
  project?: string;
  installed: InstalledJava[];
  /** The Java major a launch would otherwise have met, for an explanation. */
  found?: string;
  note?: string };

/** The person's own choice of Java: the Zed extension's `java_home`, or the two names
 * vscode-java reads, `java.jdt.ls.java.home` before the older `java.home`. */
export function configuredJavaHome(settings: Record<string, unknown> | undefined, home = os.homedir()): string | undefined {
  const java = record(settings?.java);
  const value = [settings?.java_home, record(record(record(java.jdt).ls).java).home, java.home].find((entry): entry is string => typeof entry === 'string' && !!entry.trim());
  return value?.startsWith('~') ? path.join(home, value.slice(1)) : value;
}

/** vscode-java `resolveRequirements`, for an editor that ships no Java of its own.
 * A JDK the person named runs the tool when it is new enough; an older one is not used
 * for the tool and stays the project default. Otherwise the tool runs on the newest
 * installed JDK of the best place, and that one is the project default too. */
export async function javaPlan(env: NodeJS.ProcessEnv, settings: Record<string, unknown> | undefined, minimum = jdtlsJava,
  places: JavaPlaces = systemJavaPlaces(env), home = env.HOME || env.USERPROFILE || os.homedir()): Promise<JavaPlan> {
  const installed = await installedJava(env, places, home);
  const named = configuredJavaHome(settings, home);
  const usual = await defaultJava(env);
  if (named) {
    const chosen = path.isAbsolute(named) ? await javaHome(named) : undefined;
    if (!chosen) return { installed, found: usual && String(usual.major) };
    if (chosen.major >= minimum) return { tooling: chosen, project: chosen.home, installed, found: String(chosen.major) };
    const tooling = preferredJava(installed).find(java => java.major >= minimum);
    return { tooling, project: chosen.home, installed, found: String(chosen.major),
      ...(tooling ? { note: `Java ${tooling.major} at ${tooling.home} (the tool needs Java ${minimum} or newer; the Java ${chosen.major} set for it stays the project default)` } : {}) };
  }
  const tooling = preferredJava(installed).find(java => java.major >= minimum);
  return { tooling, project: tooling?.home, installed, found: usual && String(usual.major),
    ...(tooling && tooling.home !== usual?.home ? { note: `Java ${tooling.major} at ${tooling.home} (the tool needs Java ${minimum} or newer${usual ? `; the environment's Java is ${usual.major}` : ''})` } : {}) };
}

/** vscode-java `getJavaConfig`: what jdt.ls is told about Java on this computer. `java.home`
 * is the default for a project whose build names no release, unless the person marked one of
 * their runtimes as the default. `java.configuration.detectJdksAtStart: false` keeps the list
 * to what the person wrote. */
export function javaSettings(plan: JavaPlan, settings: Record<string, unknown> | undefined): Record<string, unknown> {
  const configuration = record(record(settings?.java).configuration);
  const runtimes = projectRuntimes(configuration.runtimes, configuration.detectJdksAtStart === false ? [] : plan.installed);
  if (!plan.project && !runtimes.length) return {};
  return { java: { ...(plan.project ? { home: plan.project } : {}), ...(runtimes.length ? { configuration: { runtimes } } : {}) } };
}

export type ToolRuntime = {
  launch: ServerLaunch;
  /** What was decided about Java, when the tool is jdt.ls. */
  java?: JavaPlan;
  /** The runtime the launch would have used, for an explanation when the tool still cannot start. */
  found?: string;
  note?: string };

/** A `jdtls` launcher reads `JAVA_HOME`. It is started with the JDK vscode-java would
 * run jdt.ls on, which can be newer than the one the project is built with. */
export async function toolRuntime(launch: ServerLaunch, env: NodeJS.ProcessEnv = launch.env ?? process.env, settings?: Record<string, unknown>, places: JavaPlaces = systemJavaPlaces(env)): Promise<ToolRuntime> {
  const minimum = await javaRequirement(launch);
  if (!minimum) return { launch };
  const java = await javaPlan(env, settings, minimum, places);
  if (!java.tooling || java.tooling.home === env.JAVA_HOME) return { launch, java, found: java.found };
  return { launch: { ...launch, env: { ...env, JAVA_HOME: java.tooling.home } }, java, found: java.found, note: java.note };
}
