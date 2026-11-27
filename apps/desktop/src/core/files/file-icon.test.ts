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
  test.each([
    ['slides.pptx', '_powerpoint'], ['OLD.PPT', '_powerpoint'], ['show.ppsx', '_powerpoint'], ['template.potx', '_powerpoint'], ['talk.odp', '_powerpoint'],
    ['letter.hwp', '_hwp'], ['letter.hwpx', '_hwp'],
  ])('%s has no Seti glyph and gets the icon Setdown draws (%s)', (path, id) => {
    const icon = fileIcon(path);
    expect(icon.id).toBe(id);
    expect(icon.character).toBe('');
    // One closed drawing in the 16-unit box; a colour for each appearance.
    expect(icon.path).toMatch(/^M[\d\s.,a-zA-Z-]+Z$/);
    expect(icon.dark).toMatch(/^#[0-9a-f]{6}$/); expect(icon.light).not.toBe(icon.dark);
  });
  test.each([
    ['report.docx', '_word'], ['macro.docm', '_word'], ['memo.rtf', '_word'], ['essay.odt', '_word'],
    ['budget.xlsx', '_xls'], ['macro.xlsm', '_xls'], ['binary.xlsb', '_xls'], ['sheet.ods', '_xls'],
  ])('%s keeps or borrows the Seti glyph of its family (%s)', (path, id) => {
    const icon = fileIcon(path);
    expect(icon.id).toBe(id);
    expect(icon.character).toHaveLength(1);
    expect(icon.path).toBeUndefined();
  });
  test('the PowerPoint and Hangul drawings differ from each other', () => {
    expect(fileIcon('a.pptx').path).not.toBe(fileIcon('a.hwp').path);
    expect(fileIcon('a.pptx').dark).not.toBe(fileIcon('a.hwp').dark);
  });
  test('unknown and special object property names use the ordinary file fallback', () => {
    for (const name of ['unknown.zzzz', 'constructor', '__proto__', 'folder/toString']) {
      expect(fileIcon(name).id).toBe('_default');
    }
    expect(fileIcon('README.md').light).not.toBe(fileIcon('README.md').dark);
  });
});
