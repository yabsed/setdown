import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredJavaHome, defaultJava, installedJava, isJdtls, javaPlan, javaRequirement, javaRuntimeName, javaRuntimeNames, javaSettings, jdtlsJava,
  preferredJava, projectRuntimes, toolRuntime, type InstalledJava, type JavaPlaces } from './tool-runtime';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-runtime-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const java = process.platform === 'win32' ? 'java.exe' : 'java';
/** A JDK as its installer leaves it: the program, the `release` file and the class library. */
async function jdk(folder: string, version: string | undefined, library: string | null = version?.startsWith('1.') ? 'jre/lib/rt.jar' : 'lib/jrt-fs.jar'): Promise<string> {
  const home = path.join(directory, folder);
  await mkdir(path.join(home, 'bin'), { recursive: true });
  await writeFile(path.join(home, 'bin', java), '#!/bin/sh\nexit 1\n'); await chmod(path.join(home, 'bin', java), 0o755).catch(() => {});
  if (version) await writeFile(path.join(home, 'release'), `IMPLEMENTOR="Test"\nJAVA_VERSION="${version}"\n`);
  if (library) { await mkdir(path.dirname(path.join(home, library)), { recursive: true }); await writeFile(path.join(home, library), ''); }
  return home;
}
async function jdtls(minimum = 21): Promise<string> {
  const bin = path.join(directory, 'jdtls', 'bin'); await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'jdtls.py'), `def get_java_executable():\n\tif java_major_version < ${minimum}:\n\t\traise Exception("jdtls requires at least Java ${minimum}")\n`);
  await writeFile(path.join(bin, 'jdtls'), '#!/usr/bin/env python3\n'); return path.join(bin, 'jdtls');
}
const home = () => path.join(directory, 'home');
const env = (javaHome?: string, more: NodeJS.ProcessEnv = {}) => ({ HOME: home(), PATH: '', ...(javaHome ? { JAVA_HOME: javaHome } : {}), ...more });
const system = (): JavaPlaces => ({ folders: [path.join(directory, 'jvm')], homebrew: [] });
const none: JavaPlaces = { folders: [], homebrew: [] };
const brief = (list: InstalledJava[]) => list.map(entry => `${entry.major}:${entry.sources.join('+') || 'system'}`);

test.skipIf(process.platform === 'win32')('every JDK is listed once, with the places it was found in', async () => {
  const java17 = await jdk('jvm/java-17-temurin-jdk', '17.0.21'), java25 = await jdk('jvm/java-25-openjdk', '25.0.5');
  // What a distribution leaves around its JDKs: a link to the default one, and the folder of a removed package.
  await symlink(java25, path.join(directory, 'jvm', 'java')); await mkdir(path.join(directory, 'jvm', 'java-21-openjdk', 'man'), { recursive: true });
  // A folder with a `java` and no class library is not a Java home, and one that states no release is not listed.
  await jdk('jvm/program-only', '21.0.4', null); await jdk('jvm/unversioned', undefined);
  const sdkman = await jdk('home/.sdkman/candidates/java/21.0.4-tem', '21.0.4'); await symlink(sdkman, path.join(home(), '.sdkman/candidates/java/current'));
  // Gradle keeps a toolchain in the folder named after it, and older releases one folder below.
  await jdk('home/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2', '17.0.18'); await jdk('home/.gradle/jdks/adoptopenjdk-11-amd64-linux/jdk-11.0.2+7', '11.0.2');
  await jdk('home/.jdks/legacy-8', '1.8.0_402'); await jdk('home/.asdf/installs/java/zulu-26', '26');
  const found = await installedJava(env(java17, { PATH: [path.join(java17, 'bin'), '/nonexistent/bin'].join(path.delimiter) }), system(), home());
  // Java 25 is met first, through the `java` link, and is listed under its own folder.
  expect(brief(found)).toEqual(['21:SDKMAN', '25:system', '17:JAVA_HOME+PATH', '26:asdf', '11:Gradle', '17:Gradle', '8:IntelliJ']);
  expect(found.find(entry => entry.major === 25)?.home).toBe(java25);
  // The environment's own Java first, then a version manager, a system folder, and what a build tool downloaded.
  expect(brief(preferredJava(found))).toEqual(['17:JAVA_HOME+PATH', '26:asdf', '21:SDKMAN', '25:system', '17:Gradle', '11:Gradle', '8:IntelliJ']);
  // Version managers that are told where to keep their JDKs.
  const moved = await installedJava(env(undefined, { SDKMAN_DIR: path.join(home(), '.sdkman'), ASDF_DATA_DIR: path.join(home(), '.asdf'), GRADLE_USER_HOME: path.join(home(), '.gradle'), JDK_HOME: `${java25}/` }), none, path.join(directory, 'elsewhere'));
  expect(brief(moved)).toEqual(['21:SDKMAN', '25:JDK_HOME', '26:asdf', '11:Gradle', '17:Gradle']);
});

test.skipIf(process.platform === 'win32')('the tool runs on the newest Java of the best place, and projects are offered every JDK', async () => {
  // A computer whose shell sets Java 17 while Java 25 is installed beside it.
  const java17 = await jdk('jvm/java-17-temurin-jdk', '17.0.21'), java25 = await jdk('jvm/java-25-openjdk', '25.0.5');
  const plan = await javaPlan(env(java17), {}, jdtlsJava, system(), home());
  expect(plan).toMatchObject({ tooling: { home: java25, major: 25 }, project: java25, found: '17' });
  expect(plan.note).toContain("the environment's Java is 17");
  expect(javaSettings(plan, {})).toEqual({ java: { home: java25, configuration: { runtimes: [{ name: 'JavaSE-17', path: java17 }, { name: 'JavaSE-25', path: java25 }] } } });
  // A Java the environment names is used ahead of a newer one that is merely installed.
  const java26 = await jdk('jvm/java-26-openjdk', '26');
  expect(await javaPlan(env(java25), {}, jdtlsJava, system(), home())).toMatchObject({ tooling: { home: java25 }, project: java25, found: '25' });
  expect((await javaPlan(env(java25), {}, jdtlsJava, system(), home())).note).toBeUndefined();
  expect(await javaPlan(env(java17), {}, jdtlsJava, system(), home())).toMatchObject({ tooling: { home: java26 } });
  // Nothing new enough: the tool is left to say so, and the explanation has the Java that was found.
  const unmet = await javaPlan(env(java17), {}, 30, system(), home());
  expect([unmet.tooling, unmet.project, unmet.found, unmet.note]).toEqual([undefined, undefined, '17', undefined]);
});

test.skipIf(process.platform === 'win32')('a Java the person named runs the tool when it is new enough, and stays the project default when it is not', async () => {
  const java17 = await jdk('jvm/java-17', '17.0.21'), java25 = await jdk('jvm/java-25', '25.0.5'), own = await jdk('home/own-26', '26');
  expect(await javaPlan(env(java17), { java_home: '~/own-26' }, jdtlsJava, system(), home())).toMatchObject({ tooling: { home: own, major: 26 }, project: own, found: '26' });
  const old = await javaPlan(env(), { java: { jdt: { ls: { java: { home: java17 } } } } }, jdtlsJava, system(), home());
  expect(old).toMatchObject({ tooling: { home: java25 }, project: java17, found: '17' });
  expect(old.note).toContain('stays the project default');
  expect(javaSettings(old, {})).toMatchObject({ java: { home: java17 } });
  // A folder that is not a JDK is not replaced by a guess; the tool reports it.
  const wrong = await javaPlan(env(java17), { java_home: path.join(directory, 'missing') }, jdtlsJava, system(), home());
  expect([wrong.tooling, wrong.project, wrong.found]).toEqual([undefined, undefined, '17']);
  expect(configuredJavaHome({ java: { home: '/old/name' } })).toBe('/old/name');
  expect(configuredJavaHome({ java_home: '/a', java: { home: '/b', jdt: { ls: { java: { home: '/c' } } } } })).toBe('/a');
  expect(configuredJavaHome({ java_home: '  ' })).toBeUndefined();
});

test('the runtimes a person wrote stay as written and the others are added by their release', () => {
  const installed: InstalledJava[] = [{ home: '/jvm/8', major: 8, sources: [] }, { home: '/jvm/17', major: 17, sources: ['JAVA_HOME'] }, { home: '/sdk/17', major: 17, sources: ['SDKMAN'] },
    { home: '/jvm/25', major: 25, sources: [] }, { home: '/jvm/7', major: 7, sources: [] }, { home: '/jvm/99', major: 99, sources: [] }];
  // One JDK for a release, the preferred one. A release jdt.ls has no name for is not offered.
  expect(projectRuntimes(undefined, installed)).toEqual([{ name: 'JavaSE-17', path: '/jvm/17' }, { name: 'JavaSE-25', path: '/jvm/25' }, { name: 'JavaSE-1.8', path: '/jvm/8' }]);
  const written = [{ name: 'JavaSE-17', path: '/custom/17', default: true }];
  expect(projectRuntimes(written, installed)).toEqual([{ name: 'JavaSE-17', path: '/custom/17', default: true }, { name: 'JavaSE-25', path: '/jvm/25' }, { name: 'JavaSE-1.8', path: '/jvm/8' }]);
  expect(written).toEqual([{ name: 'JavaSE-17', path: '/custom/17', default: true }]);
  const plan = { tooling: { home: '/jvm/25', major: 25 }, project: '/jvm/25', installed };
  expect(javaSettings(plan, { java: { configuration: { detectJdksAtStart: false, runtimes: written } } })).toEqual({ java: { home: '/jvm/25', configuration: { runtimes: written } } });
  expect(javaSettings(plan, { java: { configuration: { detectJdksAtStart: false } } })).toEqual({ java: { home: '/jvm/25' } });
  expect(javaSettings({ installed: [] }, {})).toEqual({});
  expect([5, 8, 9, 25].map(javaRuntimeName)).toEqual(['J2SE-1.5', 'JavaSE-1.8', 'JavaSE-9', 'JavaSE-25']);
});

test.skipIf(process.platform === 'win32')('a jdtls launcher is started with the Java the plan chose', async () => {
  const java17 = await jdk('home/.jdks/temurin-17', '17.0.21'); await jdk('home/.jdks/openjdk-21', '21.0.4'); const java25 = await jdk('home/.jdks/openjdk-25', '25.0.4.1');
  const launch = { executable: await jdtls(), args: [], env: env(java17) };
  expect(await javaRequirement(launch)).toBe(21);
  expect(await defaultJava(launch.env)).toEqual({ home: java17, major: 17 });
  const chosen = await toolRuntime(launch, launch.env, {}, none);
  expect(chosen.launch.env).toMatchObject({ JAVA_HOME: java25 });
  expect(chosen).toMatchObject({ java: { tooling: { home: java25 }, project: java25 }, found: '17' });
  expect(chosen.note).toContain('the tool needs Java 21 or newer');
  const satisfied = { executable: await jdtls(), args: [], env: env(java25) };
  expect(await toolRuntime(satisfied, satisfied.env, {}, none)).toMatchObject({ launch: satisfied, found: '25' });
  // Another program, or a launcher that states no minimum, is not given a runtime it did not ask for.
  const other = { executable: process.execPath, args: [], env: env() };
  expect(await toolRuntime(other, other.env, {}, none)).toEqual({ launch: other });
  await rm(home(), { recursive: true }); const only17 = await jdk('home/.jdks/temurin-17', '17.0.21');
  const unmet = { executable: await jdtls(), args: [], env: env(only17) };
  const refused = await toolRuntime(unmet, unmet.env, {}, none);
  expect([refused.launch, refused.java?.tooling, refused.found]).toEqual([unmet, undefined, '17']);
  expect(await javaRequirement({ executable: await jdtls(25) })).toBe(25);
});

test('jdt.ls is recognized by the names a definition carries it by', () => {
  const definition = (id: string, command: string, profile?: string) => ({ id, launch: { kind: 'native', command }, ...(profile ? { provenance: { profile } } : {}) });
  expect([definition('jdtls', 'jdtls'), definition('custom-java', 'jdtls'), definition('java-tool', '/opt/x', 'jdtls')].map(isJdtls)).toEqual([true, true, true]);
  expect([definition('kotlin-lsp', 'kotlin-lsp'), { id: 'x', launch: { kind: 'bundledNode' } }].map(isJdtls)).toEqual([false, false]);
});

// The numbers copied from the VS Code Java extension are compared with the copy in `vendor`,
// so a newer submodule that changes them fails here and not in someone's project.
const upstream = fileURLToPath(new URL('../../../../../vendor/vscode-java', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the copied limits are the ones vendor/vscode-java states', () => {
  const required = Number(/const REQUIRED_JDK_VERSION = (\d+);/.exec(readFileSync(path.join(upstream, 'src/requirements.ts'), 'utf8'))?.[1]);
  expect(jdtlsJava).toBe(required);
  const contributed = JSON.parse(readFileSync(path.join(upstream, 'package.json'), 'utf8')).contributes.configuration as unknown;
  const names = (Array.isArray(contributed) ? contributed : [contributed]).map(category => category?.properties?.['java.configuration.runtimes']?.items?.properties?.name?.enum).find(Array.isArray) as string[];
  const ours = Array.from({ length: javaRuntimeNames.newest - javaRuntimeNames.oldest + 1 }, (_, index) => javaRuntimeName(javaRuntimeNames.oldest + index));
  expect(ours).toEqual(names);
});
