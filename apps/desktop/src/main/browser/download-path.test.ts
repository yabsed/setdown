import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { releaseDownloadReservation, reserveDownloadPath } from './download-path';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('reserves unique names in the downloads folder and releases only empty placeholders', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  const first = reserveDownloadPath(root, 'report.pdf');
  const second = reserveDownloadPath(root, '../report.pdf');
  const archive = reserveDownloadPath(root, 'data.tar.gz');
  const archive2 = reserveDownloadPath(root, 'data.tar.gz');
  expect([first, second, archive, archive2].map(file => path.basename(file))).toEqual(['report.pdf', 'report (1).pdf', 'data.tar.gz', 'data (1).tar.gz']);
  await writeFile(first, 'downloaded');
  await releaseDownloadReservation(first);
  await releaseDownloadReservation(second);
  expect((await readdir(root)).sort()).toEqual(['data (1).tar.gz', 'data.tar.gz', 'report.pdf']);
});
