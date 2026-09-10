import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LaunchedApp = {
  application: ElectronApplication;
  page: Page;
  directory: string;
  markdownPath: string;
  close: () => Promise<void>;
};

/** 지정한 Markdown 하나를 열어 둔 MarkTex를 띄운다. */
export async function launchWithDocument(
  fileName: string,
  contents: string,
): Promise<LaunchedApp> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktex-e2e-'));
  const markdownPath = path.join(directory, fileName);
  await fs.writeFile(markdownPath, contents, 'utf8');

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    args: [
      '.',
      markdownPath,
      `--user-data-dir=${path.join(directory, 'profile')}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
    env: environment,
  });

  const page = await application.firstWindow();
  page.on('pageerror', (error) => console.error(`[renderer:error] ${error.stack ?? error.message}`));

  const close = async () => {
    const childProcess = application.process();
    const exited = childProcess.exitCode === null
      ? new Promise<void>((resolve) => childProcess.once('exit', () => resolve()))
      : Promise.resolve();
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (childProcess.exitCode === null) childProcess.kill();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  return { application, page, directory, markdownPath, close };
}
