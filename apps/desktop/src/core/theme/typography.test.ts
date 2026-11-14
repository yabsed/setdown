import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_FONT_FAMILY } from './typography';

const source = fileURLToPath(new URL('../..', import.meta.url));
const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(folder, entry.name);
  return entry.isDirectory() ? files(file) : [file];
});

describe('app typography', () => {
  it('declares one Monoplex KR stack for TypeScript and CSS consumers', () => {
    expect(APP_FONT_FAMILY).toBe('"Monoplex KR", "D2Coding", ui-monospace, monospace');
    const css = readFileSync(path.join(source, 'renderer/style.css'), 'utf8');
    expect(css.match(/--app-font-family:\s*([^;]+);/)?.[1]).toBe(APP_FONT_FAMILY);
  });
  it('keeps the family names out of every other source file', () => {
    // A surface that names a family itself silently keeps the old font when
    // the stack changes; the two declarations above are the only owners.
    const owners = ['core/theme/typography.ts', 'core/theme/typography.test.ts', 'renderer/style.css'].map(file => path.join(source, file));
    const strays = files(source).filter(file => /\.(ts|svelte|css|html)$/.test(file) && !owners.includes(file)
      && !file.includes(`${path.sep}upstream${path.sep}`) && /Monoplex KR|D2Coding/i.test(readFileSync(file, 'utf8')));
    expect(strays.map(file => path.relative(source, file))).toEqual([]);
  });
});
