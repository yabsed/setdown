import os from 'node:os';
import path from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import type { ServerLaunch } from './server-session';

export type JavaHome = { home: string; major: number };
const javaBinary = process.platform === 'win32' ? 'java.exe' : 'java';

/** A JDK states its version in its `release` file. No candidate is executed. */
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

/** Where operating-system packages and vendor installers put JDKs. */
export function systemJavaDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  return process.platform === 'darwin' ? ['/Library/Java/JavaVirtualMachines']
    : process.platform === 'win32' ? [env.ProgramFiles, env['ProgramFiles(x86)']].flatMap(root => root ? ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft'].map(vendor => path.join(root, vendor)) : [])
      : ['/usr/lib/jvm', '/usr/lib64/jvm', '/usr/java', '/opt/java', '/opt/jdk'];
}

/** JDKs in the known directories of system packages and version managers. */
export async function installedJava(env: NodeJS.ProcessEnv, system = systemJavaDirectories(env), home = env.HOME || env.USERPROFILE || os.homedir()): Promise<JavaHome[]> {
  const parents = [...system, ...(process.platform === 'darwin' ? [path.join(home, 'Library/Java/JavaVirtualMachines')] : [])];
  parents.push(...['.sdkman/candidates/java', '.jdks', '.asdf/installs/java', '.local/share/mise/installs/java', '.jabba/jdk', '.gradle/jdks', '.m2/jdks'].map(folder => path.join(home, folder)));
  const candidates = [env.JAVA_HOME, env.JDK_HOME].filter((entry): entry is string => !!entry && path.isAbsolute(entry));
  for (const parent of parents) {
    const names = await readdir(parent).catch(() => [] as string[]);
    for (const name of names.slice(0, 200)) candidates.push(path.join(parent, name), path.join(parent, name, 'Contents', 'Home'));
  }
  const found = new Map<string, JavaHome>();
  for (const candidate of candidates) { const java = await javaHome(candidate); if (java) found.set(java.home, java); }
  const fallback = await defaultJava(env); if (fallback) found.set(fallback.home, fallback);
  return [...found.values()].sort((a, b) => a.major - b.major || a.home.localeCompare(b.home));
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

export type ToolRuntime = {
  launch: ServerLaunch;
  /** The JDK the project would use by default, when the tool runs on another one. */
  project?: JavaHome;
  /** The runtime the launch would have used, for an explanation when the tool still cannot start. */
  found?: string;
  note?: string };

/** A tool may need a newer Java than the project it analyzes. Run the tool on the
 * closest installed JDK that satisfies it and leave the project's own JDK as it is. */
export async function toolRuntime(launch: ServerLaunch, env: NodeJS.ProcessEnv = launch.env ?? process.env, system = systemJavaDirectories(env)): Promise<ToolRuntime> {
  const minimum = await javaRequirement(launch);
  if (!minimum) return { launch };
  const current = await defaultJava(env);
  if (current && current.major >= minimum) return { launch, found: String(current.major) };
  const suitable = (await installedJava(env, system)).find(java => java.major >= minimum);
  if (!suitable) return { launch, found: current ? String(current.major) : undefined };
  return { launch: { ...launch, env: { ...env, JAVA_HOME: suitable.home } }, project: current, found: current ? String(current.major) : undefined,
    note: `Java ${suitable.major} at ${suitable.home} (the tool needs Java ${minimum} or newer${current ? `; the project default is Java ${current.major}` : ''})` };
}

/** Keeps the project on its own JDK while the tool runs on a newer one. */
export function projectRuntimeSettings(project: JavaHome | undefined): Record<string, unknown> {
  if (!project) return {};
  return { java: { configuration: { runtimes: [{ name: project.major <= 8 ? `JavaSE-1.${project.major}` : `JavaSE-${project.major}`, path: project.home, default: true }] } } };
}
