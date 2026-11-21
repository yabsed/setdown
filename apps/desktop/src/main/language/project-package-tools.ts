// Some Zed extensions install nothing: they start their tool out of the project's own packages.
// The Angular extension (zed-angular 0.0.7, `src/angular.rs`) runs
// `<project>/node_modules/@angular/language-server/index.js`, and a project that never added that
// package gets "Cannot find module". The extension reads one option of its own,
// `lsp.angular.initialization_options.angular_language_server_path`, for another copy, and then
// looks for TypeScript and Angular's own packages in the project first and beside that copy next.
//
// VS Code's Angular extension brings the server itself and looks in the project for the rest
// (`vscode-ng-language-service`, `client/src/client.ts`). Setdown does the same through the
// extension's option: where the project has no copy, it installs the version the Mason registry
// pins and names it there. What the person wrote in that option is left alone.

import path from 'node:path';
import { existsSync } from 'node:fs';
import mason from './catalog/mason.json';

/** `package`: the npm package the extension starts from the project. `option`: the extension's
 * initialization option that names another copy's folder. `mason`: the Mason package that pins a version. */
export type ProjectPackageTool = { package: string; option: string; mason: string };
/** By the name Zed knows the tool by. */
export const projectPackageTools: Readonly<Record<string, ProjectPackageTool>> = {
  angular: { package: '@angular/language-server', option: 'angular_language_server_path', mason: 'angular-language-server' },
};

/** Whether the project has its own copy, where the extension looks for it. */
export const projectHasPackage = (root: string, tool: ProjectPackageTool): boolean => existsSync(path.join(root, 'node_modules', tool.package, 'package.json'));

/** The npm package and version a Mason entry pins, and the name of a program it installs. */
export function pinnedNpmPackage(id: string): { package: string; version: string; command: string } | undefined {
  const entry = mason.packages.find(item => item.id === id), source = entry?.source.id;
  if (!entry || !source?.startsWith('pkg:npm/')) return undefined;
  const at = source.lastIndexOf('@');
  return { package: decodeURIComponent(source.slice(8, at)), version: source.slice(at + 1).split('?')[0], command: entry.executables?.[0] ?? '' };
}

/** The folder of a package inside what the host installed for it: the nearest folder above the
 * started script that is the package. */
export function installedPackageFolder(script: string, name: string): string | undefined {
  const marker = path.join('node_modules', ...name.split('/'));
  for (let directory = path.dirname(script), depth = 0; depth < 32; depth++, directory = path.dirname(directory)) {
    if (directory.endsWith(path.sep + marker) && existsSync(path.join(directory, 'package.json'))) return directory;
    if (path.dirname(directory) === directory) break;
  }
  return undefined;
}
