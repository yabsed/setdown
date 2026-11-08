// Snapshot VS Code's pinned Seti theme and language associations. Runtime never
// imports Monaco, a language server, or the reference checkout to draw an icon.
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'jsonc-parser';

const app = fileURLToPath(new URL('../', import.meta.url));
const vscode = path.resolve(app, '../../vendor/vscode');
const themeRoot = path.join(vscode, 'extensions/theme-seti');
const theme = JSON.parse(await readFile(path.join(themeRoot, 'icons/vs-seti-icon-theme.json'), 'utf8'));
const extensions = {}, names = {};
for (const entry of (await readdir(path.join(vscode, 'extensions'))).sort()) {
  let manifest;
  try { manifest = parse(await readFile(path.join(vscode, 'extensions', entry, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
  for (const language of manifest.contributes?.languages ?? []) {
    const icon = theme.languageIds[language.id];
    if (!icon) continue;
    for (const extension of language.extensions ?? []) extensions[extension.slice(1).toLowerCase()] = icon;
    for (const name of language.filenames ?? []) names[name.toLowerCase()] = icon;
  }
}
// Exact Seti associations take precedence over detected language, as in VS Code.
Object.assign(extensions, theme.fileExtensions);
Object.assign(names, theme.fileNames);
const icons = {};
for (const id of new Set([theme.file, ...Object.values(extensions), ...Object.values(names)])) {
  const dark = theme.iconDefinitions[id], light = theme.iconDefinitions[`${id}_light`] ?? dark;
  icons[id] = { character: String.fromCodePoint(parseInt(dark.fontCharacter.slice(1), 16)),
    dark: dark.fontColor ?? 'currentColor', light: light.fontColor ?? 'currentColor' };
}
const output = path.join(app, 'src/core/files');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'seti-icons.json'), JSON.stringify({
  source: 'https://github.com/microsoft/vscode/tree/' + execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vscode, encoding: 'utf8' }).trim() + '/extensions/theme-seti',
  upstream: theme.version, file: theme.file, icons, extensions, names,
}, null, 2) + '\n');
await copyFile(path.join(themeRoot, 'icons/seti.woff'), path.join(output, 'seti.woff'));
await writeFile(path.join(output, 'SETI-NOTICE.txt'),
  (await readFile(path.join(themeRoot, 'ThirdPartyNotices.txt'), 'utf8')).replace(/\r\n/g, '\n'));
