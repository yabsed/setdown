import { afterEach, beforeEach, expect, test } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultJava, installedJava, javaRequirement, projectRuntimeSettings, toolRuntime } from './tool-runtime';

let directory = '';
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-runtime-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function jdk(name: string, version: string): Promise<string> {
  const home = path.join(directory, 'home', '.jdks', name);
  await mkdir(path.join(home, 'bin'), { recursive: true });
  await writeFile(path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '#!/bin/sh\nexit 1\n'); await chmod(path.join(home, 'bin', 'java'), 0o755).catch(() => {});
  await writeFile(path.join(home, 'release'), `IMPLEMENTOR="Test"\nJAVA_VERSION="${version}"\n`);
  return home;
}
async function jdtls(minimum = 21): Promise<string> {
  const bin = path.join(directory, 'jdtls', 'bin'); await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'jdtls.py'), `def get_java_executable():\n\tif java_major_version < ${minimum}:\n\t\traise Exception("jdtls requires at least Java ${minimum}")\n`);
  await writeFile(path.join(bin, 'jdtls'), '#!/usr/bin/env python3\n'); return path.join(bin, 'jdtls');
}
const env = (home: string | undefined) => ({ HOME: path.join(directory, 'home'), PATH: '', ...(home ? { JAVA_HOME: home } : {}) });

test.skipIf(process.platform === 'win32')('the tool runs on the closest installed Java that satisfies it and the project keeps its own', async () => {
  const [java17, java21] = [await jdk('temurin-17', '17.0.21'), await jdk('openjdk-21', '21.0.4')]; await jdk('openjdk-25', '25.0.4.1'); await jdk('legacy-8', '1.8.0_402');
  const launch = { executable: await jdtls(), args: [], env: env(java17) };
  expect(await javaRequirement(launch)).toBe(21);
  expect(await defaultJava(launch.env)).toEqual({ home: java17, major: 17 });
  expect((await installedJava(launch.env, [])).map(java => java.major)).toEqual([8, 17, 21, 25]);
  const chosen = await toolRuntime(launch, launch.env, []);
  // Java 21, not the newest: the release the tool was built against is the nearest one that satisfies it.
  expect(chosen.launch.env).toMatchObject({ JAVA_HOME: java21 });
  expect(chosen).toMatchObject({ project: { home: java17, major: 17 }, found: '17' });
  expect(chosen.note).toContain('the project default is Java 17');
  expect(projectRuntimeSettings(chosen.project)).toEqual({ java: { configuration: { runtimes: [{ name: 'JavaSE-17', path: java17, default: true }] } } });
  expect(projectRuntimeSettings({ home: '/jdk8', major: 8 })).toEqual({ java: { configuration: { runtimes: [{ name: 'JavaSE-1.8', path: '/jdk8', default: true }] } } });
});

test.skipIf(process.platform === 'win32')('a satisfied or unknown requirement changes nothing, and an unmet one is left to be explained', async () => {
  const java25 = await jdk('openjdk-25', '25.0.4.1');
  const satisfied = { executable: await jdtls(), args: [], env: env(java25) };
  expect(await toolRuntime(satisfied, satisfied.env, [])).toEqual({ launch: satisfied, found: '25' });
  // Another program, or a launcher that states no minimum, is not given a runtime it did not ask for.
  const other = { executable: process.execPath, args: [], env: env(undefined) };
  expect(await toolRuntime(other, other.env, [])).toEqual({ launch: other });
  await rm(path.join(directory, 'home'), { recursive: true }); const java17 = await jdk('temurin-17', '17.0.21');
  const unmet = { executable: await jdtls(), args: [], env: env(java17) };
  expect(await toolRuntime(unmet, unmet.env, [])).toEqual({ launch: unmet, found: '17' });
  expect(await javaRequirement({ executable: await jdtls(25) })).toBe(25);
});
