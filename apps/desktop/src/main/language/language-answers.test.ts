import { mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { isLanguageAnswer, languageAnswerFolder } from '../../protocol/language';
import { answerFileName, pruneLanguageAnswers, writeLanguageAnswer } from './language-answers';

const folders: string[] = [];
const fresh = async () => { const folder = await mkdtemp(path.join(os.tmpdir(), 'setdown-answers-')); folders.push(folder); return folder; };
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

test('an answer is named as a person reads it and coloured as its language', () => {
  expect(answerFileName({ title: 'Macro expansion', text: '', languageId: 'rust' })).toBe('Macro expansion.rs');
  expect(answerFileName({ title: 'Compiled CSS', text: '', languageId: 'css' })).toBe('Compiled CSS.css');
  expect(answerFileName({ title: 'rust-analyzer status', text: '' })).toBe('rust-analyzer status.txt');
  expect(answerFileName({ title: 'Crate graph (full)', text: '<svg/>', image: true })).toBe('Crate graph (full).svg');
  // A title a tool made up cannot name a folder, a hidden file or nothing at all.
  expect(answerFileName({ title: '../../etc/passwd', text: '' })).toBe('etc passwd.txt');
  expect(answerFileName({ title: '///', text: '' })).toBe('Answer.txt');
  expect(answerFileName({ title: 'x'.repeat(300), text: '' })).toHaveLength(84);
});

test('an answer is kept as a read-only file of the app that the editor knows as an answer', async () => {
  const userData = await fresh();
  const file = await writeLanguageAnswer(userData, { title: 'Macro expansion', text: 'Vec::new()', languageId: 'rust' }, 1000);
  expect(path.dirname(path.dirname(file))).toBe(path.join(userData, languageAnswerFolder));
  expect(isLanguageAnswer(file)).toBe(true);
  expect(isLanguageAnswer(path.join(userData, 'notes', 'Macro expansion.rs'))).toBe(false);
  expect(await readFile(file, 'utf8')).toBe('Vec::new()\n');
  expect((await stat(file)).mode & 0o222).toBe(0);
  // Two answers with one title, made in the same moment, are two documents.
  const second = await writeLanguageAnswer(userData, { title: 'Macro expansion', text: 'other', languageId: 'rust' }, 1000);
  expect(second).not.toBe(file);
  expect(await readFile(file, 'utf8')).toBe('Vec::new()\n');
  // A picture is kept as the tool drew it.
  const picture = await writeLanguageAnswer(userData, { title: 'Crate graph', text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', image: true }, 2000);
  expect(await readFile(picture, 'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
});

test('what is not an answer is refused before anything is written', async () => {
  const userData = await fresh();
  await expect(writeLanguageAnswer(userData, { title: 7, text: 'x' } as never)).rejects.toThrow('Invalid language answer.');
  await expect(writeLanguageAnswer(userData, { title: 'x', text: 7 } as never)).rejects.toThrow('Invalid language answer.');
  await expect(writeLanguageAnswer(userData, null as never)).rejects.toThrow('Invalid language answer.');
  await expect(writeLanguageAnswer(userData, { title: 'x'.repeat(201), text: '' })).rejects.toThrow('Invalid language answer.');
  await expect(writeLanguageAnswer(userData, { title: 'Graph', text: 'not a picture', image: true })).rejects.toThrow('The picture is not an SVG.');
  await expect(readdir(path.join(userData, languageAnswerFolder))).rejects.toThrow();
});

test('older answers are removed and the newest stay', async () => {
  const userData = await fresh(), folder = path.join(userData, languageAnswerFolder);
  const files: string[] = [];
  for (let index = 0; index < 5; index++) {
    const file = await writeLanguageAnswer(userData, { title: `Answer ${index}`, text: String(index) }, 1000 + index);
    // The folder's time is what orders the answers; set apart so the order does not depend on the clock.
    await utimes(path.dirname(file), 1000 + index, 1000 + index);
    files.push(file);
  }
  await pruneLanguageAnswers(folder, 2);
  expect((await readdir(folder)).sort()).toEqual(files.slice(3).map(file => path.basename(path.dirname(file))).sort());
});
