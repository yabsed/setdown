import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const SOURCE = path.join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|svelte)$/.test(entry.name) ? [absolute] : [];
  });
}

function offendingFiles(directory: string, pattern: RegExp): string[] {
  return sourceFiles(path.join(SOURCE, directory))
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SOURCE, file));
}

describe('architecture boundaries', () => {
  test('core는 UI, Electron, IPC 계층을 모른다', () => {
    expect(offendingFiles('core', /(?:electron|\.\.\/main|\.\.\/renderer|\.\.\/protocol)/)).toEqual([]);
  });

  test('renderer의 Electron 전역 접근은 adapter 하나에만 있다', () => {
    expect(offendingFiles('renderer', /window\.marktex/)).toEqual([
      path.join('renderer', 'adapters', 'electron-desktop.ts'),
    ]);
  });

  test('main은 renderer와 preview runtime 구현을 역참조하지 않는다', () => {
    expect(offendingFiles('main', /\.\.\/renderer|\.\.\/preview-runtime/)).toEqual([]);
  });
});
