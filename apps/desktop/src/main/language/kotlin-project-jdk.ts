import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { kotlinJdkPlan, projectJavaRelease, type KotlinJdkPlan } from './kotlin-jdk';
import { installedJava, javaHome } from './tool-runtime';

// Reads what `kotlin-jdk.ts` decides from: the build files of the project, the JDKs of this
// computer and the JDK the environment names. Nothing here is a rule of its own.

const buildFile = /^(?:pom\.xml|.*\.gradle(?:\.kts)?)$/;
/** A build file larger than this is not one a person wrote. */
const sizeLimit = 512 * 1024;

/** The build files that say which Java a project is for: those of the project folder, and of the
 * folders directly in it, where the modules of a usual Gradle or Maven project lie. Folders whose
 * name starts with a dot and build output are passed over; at most 48 files are read. */
export async function kotlinBuildFiles(root: string): Promise<{ name: string; text: string }[]> {
  const found: string[] = [];
  const list = async (folder: string) => (await readdir(folder, { withFileTypes: true }).catch(() => [])).slice(0, 2000);
  const top = await list(root);
  for (const entry of top) if (entry.isFile() && buildFile.test(entry.name)) found.push(path.join(root, entry.name));
  for (const entry of top) {
    if (found.length >= 48) break;
    if (!entry.isDirectory() || entry.name.startsWith('.') || ['build', 'target', 'out', 'node_modules', 'gradle'].includes(entry.name)) continue;
    for (const inner of await list(path.join(root, entry.name)))
      if (inner.isFile() && buildFile.test(inner.name) && found.length < 48) found.push(path.join(root, entry.name, inner.name));
  }
  const files: { name: string; text: string }[] = [];
  for (const file of found) {
    try { if ((await stat(file)).size <= sizeLimit) files.push({ name: file, text: await readFile(file, 'utf8') }); } catch { /* A file that cannot be read says nothing. */ }
  }
  return files;
}

/** What Setdown adds to the start of kotlin-lsp for the project in `root` (`kotlinJdkPlan`).
 * `env` is the environment the server is started with. */
export async function kotlinProjectJdk(root: string, env: NodeJS.ProcessEnv, settings: unknown): Promise<KotlinJdkPlan> {
  const projectJava = projectJavaRelease(await kotlinBuildFiles(root));
  if (projectJava === undefined) return {};
  const [installed, environment] = await Promise.all([installedJava(env), env.JAVA_HOME ? javaHome(env.JAVA_HOME) : undefined]);
  return kotlinJdkPlan({ installed, environmentJava: environment?.major, projectJava, settings });
}
