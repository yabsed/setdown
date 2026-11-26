import { electron, disposeApplication } from '../../support/electron/electron-app';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearAddress } from '../../support/browser/location-controls';

const MiB = 1024 * 1024;

/** A JSON Lines log of real records, past the size held as one string (16 MiB) and past the size
 * the editor colours and wraps (20 MB): this repository's lock file, one package per line, with
 * Hangul and an emoji in every record and the whole lock file as one long line in between. */
async function writeLog(file: string, bytes = 21 * MiB): Promise<{ text: Buffer; lines: number }> {
  const lock = JSON.parse(await readFile(path.resolve('../../package-lock.json'), 'utf8')) as { packages: Record<string, unknown> };
  const packages = Object.entries(lock.packages);
  const long = JSON.stringify({ type: 'lock', note: '한 줄로 된 긴 기록 📦', lock });
  const records: string[] = [];
  let length = 0;
  for (let index = 0; length < bytes; index++) {
    const [name, entry] = packages[index % packages.length];
    const record = index === 100 ? long : JSON.stringify({ index, name, note: '꾸러미 📦', entry });
    records.push(record); length += Buffer.byteLength(record) + 1;
  }
  const text = Buffer.from(`${records.join('\n')}\n`);
  await writeFile(file, text);
  return { text, lines: records.length + 1 };
}

async function launch(root: string, file?: string) {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  return electron.launch({ args: file ? ['.', file] : ['.'], env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') } });
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** A line the editor shows. Its lines are not in the page in the order they are shown in. */
const shownLine = (page: Page, text: string) => page.locator('.editor-surface .monaco-editor .view-line', { hasText: text }).first();
const editorOf = (page: Page) => page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
/** The number of the last line the editor shows once the caret went to the end with Control+End. */
async function lastLine(page: Page): Promise<number> {
  await editorOf(page).press('Control+End');
  return page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.editor-surface .monaco-editor .line-numbers')].map(line => Number(line.textContent))));
}

test('a text file too large for one string opens, edits, saves and follows its file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-large-text-'));
  const file = path.join(root, 'session.jsonl');
  const { text: original, lines } = await writeLog(file);
  expect(original.length).toBeGreaterThan(20 * MiB);
  const application = await launch(root, file);
  try {
    const window = await application.firstWindow();
    // It opens in a tab like any file, its first record on the first line and nothing unsaved.
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await expect(shownLine(window, '{"index":0,')).toBeVisible();
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    await expect.poll(() => lastLine(window)).toBe(lines);
    // What it goes without is said where its language is shown.
    const status = window.getByRole('button', { name: /^Language status: .*Large file/ });
    await status.click();
    await expect(window.getByRole('dialog', { name: 'Current file language support' }))
      .toContainText('Syntax highlighting, word wrap and folding are off for a file this large, and it is not given to analysis tools.');
    await window.keyboard.press('Escape');

    // An edit marks it unsaved; a save writes the edit and every other byte as it was.
    const editor = editorOf(window), typed = '{"typed":"첫 줄 ✍"}';
    await editor.press('Control+Home');
    await editor.pressSequentially(typed);
    await editor.press('Enter');
    await expect(shownLine(window, '첫 줄')).toBeVisible();
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await editor.press('Control+S');
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    const saved = await readFile(file);
    expect(saved.subarray(0, Buffer.byteLength(typed) + 1).toString()).toBe(`${typed}\n`);
    expect(digest(saved.subarray(Buffer.byteLength(typed) + 1))).toBe(digest(original));
    expect(await readdir(root)).toEqual(['config', 'session.jsonl']);

    // The saved point follows undo and redo, with no comparison of the text.
    await editor.press('Control+Z');
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await editor.press('Control+Shift+Z');
    await expect(window.locator('.tab-dirty')).toHaveCount(0);

    // Lines another program appends arrive as one edit that can be undone and redone.
    await appendFile(file, '{"appended":1}\n{"appended":2}\n');
    await expect.poll(() => lastLine(window), { timeout: 15_000 }).toBe(lines + 3);
    await expect(window.locator('.notice')).toBeHidden();
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    await editor.press('Control+Z');
    await expect.poll(() => lastLine(window)).toBe(lines + 1);
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await editor.press('Control+Shift+Z');
    await expect.poll(() => lastLine(window)).toBe(lines + 3);
    await expect(window.locator('.tab-dirty')).toHaveCount(0);

    // Unsaved edits are kept when the file changes underneath them.
    await editor.press('Control+Home');
    await editor.pressSequentially('local ');
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await appendFile(file, '{"appended":3}\n');
    await expect(window.locator('.notice')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.notice')).toContainText('changed by another application');
    await expect(shownLine(window, 'local {"typed"')).toBeVisible();
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});

test('auto save and the close prompt write a large file from its editor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-large-text-'));
  const file = path.join(root, 'session.jsonl');
  const { text: original } = await writeLog(file, 17 * MiB);
  const application = await launch(root, file);
  const autoSave = async (enabled: boolean, page: Page) => {
    if (await page.evaluate(() => window.marktex.getAutoSave()) !== enabled)
      await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-auto-save'));
    await expect.poll(() => page.evaluate(() => window.marktex.getAutoSave())).toBe(enabled);
  };
  try {
    const window = await application.firstWindow();
    await expect(shownLine(window, '{"index":0,')).toBeVisible();
    const editor = editorOf(window);

    // An edit is auto saved like one in a small file: the edit and every other byte as it was.
    await autoSave(true, window);
    await editor.press('Control+Home');
    await editor.pressSequentially('auto');
    await editor.press('Enter');
    await expect.poll(async () => (await stat(file)).size, { timeout: 15_000 }).toBe(original.length + 5);
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    const auto = await readFile(file);
    expect(auto.subarray(0, 5).toString()).toBe('auto\n');
    expect(digest(auto.subarray(5))).toBe(digest(original));

    // Closing with unsaved edits asks, and Save writes the whole file.
    await autoSave(false, window);
    await editor.press('Control+Home');
    await editor.pressSequentially('closing');
    await editor.press('Enter');
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await window.locator('.tab-close').click();
    const prompt = window.locator('dialog[aria-labelledby="close-prompt-title"]');
    await expect(prompt.locator('.close-prompt-body')).toContainText('session.jsonl');
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(prompt).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await stat(file)).size, { timeout: 15_000 }).toBe(original.length + 13);
    const closed = await readFile(file);
    expect(closed.subarray(0, 13).toString()).toBe('closing\nauto\n');
    expect(digest(closed.subarray(13))).toBe(digest(original));
    expect(await readdir(root)).toEqual(['config', 'session.jsonl']);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});

test('a large file that is not text is refused with its reason and nothing is opened', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-large-text-'));
  const file = path.join(root, 'broken.jsonl');
  const { text } = await writeLog(file, 17 * MiB);
  // Cut inside a Hangul syllable far into the file: only reading all of it can tell.
  const at = text.lastIndexOf(Buffer.from('꾸러미'));
  await writeFile(file, Buffer.concat([text.subarray(0, at + 1), text.subarray(at + 3)]));
  const note = path.join(root, 'note.txt');
  await writeFile(note, 'a small note\n');
  const application = await launch(root, note);
  try {
    const window = await application.firstWindow();
    await expect(shownLine(window, 'a small note')).toBeVisible();
    const address = window.locator('.editor-group.focused .location-bar input');
    await clearAddress(address);
    await address.pressSequentially(file);
    await address.press('Enter');
    await expect(window.locator('.editor-group.focused .location-error')).toContainText('The file is not valid UTF-8. It was not opened or modified', { timeout: 15_000 });
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await expect(shownLine(window, 'a small note')).toBeVisible();
    expect((await stat(file)).size).toBe(text.length - 2);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
