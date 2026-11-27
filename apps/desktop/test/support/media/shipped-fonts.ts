import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * A machine whose installed fonts are exactly the font files this repository ships: by default the Latin substitutes
 * and one pan-CJK face ("Noto Sans CJK JP"). No Korean family is installed under its own name, and nothing that
 * happens to be installed on the test machine takes part. With the Latin package alone, no installed font has Hangul.
 */
export async function shippedFontsOnly(root: string, packages = ['@docx-editor.dev/fonts', '@docx-editor.dev/fonts-cjk']): Promise<Record<string, string>> {
  const assets = (name: string) => path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'assets');
  const file = path.join(root, 'fonts.conf');
  await writeFile(file, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>${packages.map(name => `<dir>${assets(name)}</dir>`).join('')}`
    + `<cachedir>${path.join(root, 'fontconfig-cache')}</cachedir></fontconfig>`);
  return { FONTCONFIG_FILE: file };
}
