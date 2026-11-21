import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installedPackageFolder, pinnedNpmPackage, projectHasPackage, projectPackageTools } from './project-package-tools';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("Angular's server has a pinned version to install where the project brings none", () => {
  const tool = projectPackageTools.angular;
  expect(pinnedNpmPackage(tool.mason)).toMatchObject({ package: tool.package, command: 'ngserver' });
  expect(pinnedNpmPackage(tool.mason)!.version).toMatch(/^\d+\.\d+\.\d+$/);
  // A Mason entry that is not an npm package pins nothing here.
  expect(pinnedNpmPackage('deno')).toBeUndefined();
  expect(pinnedNpmPackage('no-such-package')).toBeUndefined();
});

test("the project's own copy is found where the extension looks, and the installed one above the started script", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-project-package-')); roots.push(root);
  const tool = projectPackageTools.angular;
  expect(projectHasPackage(root, tool)).toBe(false);
  const folder = path.join(root, 'node_modules', '@angular', 'language-server');
  await mkdir(path.join(folder, 'bin'), { recursive: true });
  await writeFile(path.join(folder, 'package.json'), '{"name":"@angular/language-server"}');
  await writeFile(path.join(folder, 'bin', 'ngserver'), '');
  expect(projectHasPackage(root, tool)).toBe(true);
  expect(installedPackageFolder(path.join(folder, 'bin', 'ngserver'), tool.package)).toBe(folder);
  expect(installedPackageFolder(path.join(root, 'elsewhere', 'ngserver'), tool.package)).toBeUndefined();
});
