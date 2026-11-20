import path from 'node:path';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { languageAnswerFolder, type LanguageAnswer } from '../../protocol/language';

// Text a tool made for reading (an expanded macro, a status report, compiled code) is kept as a
// file of the app, so that it opens as an ordinary tab beside the code: it can be searched, split,
// zoomed and copied like any document, and nothing floats over the editor. The editor shows files
// of this folder read-only and starts no tool for them (`isLanguageAnswer`).

const extensions: Record<string, string> = { rust: 'rs', json: 'json', javascript: 'js', typescript: 'ts', css: 'css', c: 'c', cpp: 'cpp', go: 'go', python: 'py', toml: 'toml', yaml: 'yaml' };
const kept = 40;

/** A name a person recognizes in a tab, safe as a file name on every system. */
export function answerFileName(answer: LanguageAnswer): string {
  const title = answer.title.replace(/[^\p{L}\p{N} ._()+-]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '').slice(0, 80).trim() || 'Answer';
  return `${title}.${answer.image ? 'svg' : extensions[answer.languageId ?? ''] ?? 'txt'}`;
}

/** Writes the answer and gives the file's path. Older answers are removed, the newest `kept` stay. */
export async function writeLanguageAnswer(userData: string, answer: LanguageAnswer, now = Date.now()): Promise<string> {
  if (!answer || typeof answer.title !== 'string' || typeof answer.text !== 'string' || answer.title.length > 200 || Buffer.byteLength(answer.text) > 16 * 1024 * 1024
    || answer.languageId !== undefined && typeof answer.languageId !== 'string') throw Error('Invalid language answer.');
  if (answer.image && !/<svg[\s>]/.test(answer.text)) throw Error('The picture is not an SVG.');
  const folder = path.join(userData, languageAnswerFolder);
  await mkdir(folder, { recursive: true });
  // One folder for each answer: two answers with one title are two documents.
  let directory = path.join(folder, now.toString(36));
  for (let attempt = 1; ; attempt++) {
    try { await mkdir(directory); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 50) throw error; directory = path.join(folder, `${now.toString(36)}-${attempt}`); }
  }
  const file = path.join(directory, answerFileName(answer));
  await writeFile(file, answer.text.endsWith('\n') || answer.image ? answer.text : `${answer.text}\n`, { mode: 0o444 });
  void pruneLanguageAnswers(folder).catch(() => {});
  return file;
}

export async function pruneLanguageAnswers(folder: string, keep = kept): Promise<void> {
  const entries = await Promise.all((await readdir(folder)).map(async name => ({ name, time: (await stat(path.join(folder, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
  for (const entry of entries.sort((a, b) => b.time - a.time).slice(keep)) await rm(path.join(folder, entry.name), { recursive: true, force: true });
}
