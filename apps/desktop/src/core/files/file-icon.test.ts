import { describe, expect, test } from 'vitest';
import { fileIcon } from './file-icon';

describe('VS Code Seti file associations', () => {
  test.each([
    ['README.md', '_info'], ['note.md', '_markdown'], ['src/a.test.ts', '_typescript_1'], ['Widget.svelte', '_svelte'],
    ['package.json', '_json'], ['report.csv', '_csv'], ['photo.JPG', '_image'],
    ['photo.webp', '_image'], ['file.txt', '_default'], ['.gitignore', '_git'],
    ['Dockerfile', '_docker'], ['C:\\repo\\src\\panel.tsx', '_react'],
    ['LICENSE', '_license'], ['webpack.config.js', '_webpack'],
  ])('%s uses %s without opening the file or starting a language engine', (path, id) => {
    expect(fileIcon(path).id).toBe(id);
    expect(fileIcon(path).character).toHaveLength(1);
  });
  test('unknown and special object property names use the ordinary file fallback', () => {
    for (const name of ['unknown.zzzz', 'constructor', '__proto__', 'folder/toString']) {
      expect(fileIcon(name).id).toBe('_default');
    }
    expect(fileIcon('README.md').light).not.toBe(fileIcon('README.md').dark);
  });
});
