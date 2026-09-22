import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication, focusApplication } from './electron-app';
import { previews } from './preview-view';

const exec = promisify(execFile);
test('Graph resizes, refreshes and opens immutable Markdown revisions in existing review', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-config-'));
  const remote = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-remote-'));
  const peer = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-peer-'));
  const file = path.join(root, 'note.md');
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'History Test');
    await git('config', 'user.email', 'history@example.test');
    await writeFile(file, '# First revision\n\n$$x^2$$\n');
    await git('add', '.'); await git('commit', '-m', 'Initial document');
    const first = (await git('rev-parse', 'HEAD')).stdout.trim();
    await writeFile(file, '# Second revision\n\n$$x^2 + y^2$$\n');
    await git('commit', '-am', 'Revise document');
    const second = (await git('rev-parse', 'HEAD')).stdout.trim();
    await exec('git', ['init', '--bare', remote]);
    await git('remote', 'add', 'origin', remote);
    await git('push', '-u', 'origin', 'main');
    for (const name of ['extra-one', 'extra-two', 'extra-three']) await git('branch', name);
    await writeFile(file, '# Working document\n');
    const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: configRoot } });
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (error) => errors.push(error.message));
    await window.evaluate(async (folder) => {
      await (window as unknown as { marktex: { restoreProjectFolder(root: string): Promise<unknown> } }).marktex.restoreProjectFolder(folder);
      sessionStorage.setItem('setdown:git-graph-panel', JSON.stringify({ expanded: true, ratio: .55 }));
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await focusApplication(app);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control', exact: true }).click();
    const graph = window.locator('web-git-graph');
    await expect.poll(async () => ({
      rows: await graph.locator('.row').count(),
      busy: await graph.getAttribute('aria-busy'),
      graphErrors: await window.locator('.history-error').allTextContents(),
      appErrors: await window.locator('.project-error').allTextContents()
    })).toEqual({ rows: 2, busy: 'false', graphErrors: [], appErrors: [] });
    const pane = window.getByRole('region', { name: 'Git history', exact: true });
    const separator = window.getByRole('button', { name: 'Resize Git Graph' });
    // The pinned shadow adapter must survive theme changes and expose the
    // upstream branch picker, without the standalone table/duplicate toolbar.
    await expect(graph.locator('.header')).toBeHidden();
    await expect(graph.locator('.refresh')).toBeHidden();
    await expect(graph.locator('.row').first()).toHaveCSS('font-size', '11px');
    await expect(graph.locator('.row').first()).toHaveCSS('height', '24px');
    await expect(graph.locator('.setdown-auto')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => graph.evaluate((element) => (element as unknown as { refs: string[] }).refs))
      .toEqual(['refs/heads/main', 'refs/remotes/origin/main']);
    await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(2);
    await graph.getByRole('button', { name: 'Select branches and tags' }).click();
    await expect(graph.locator('.menu')).toBeVisible();
    await graph.getByRole('menuitem', { name: 'Show All' }).click();
    await expect(graph.locator('.setdown-auto')).toHaveAttribute('aria-pressed', 'false');
    await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(4);
    await graph.getByRole('button', { name: 'Select branches and tags' }).click();
    await expect(graph.locator('.menu')).toHaveCount(0);
    await graph.getByRole('button', { name: 'Auto branch filter' }).click();
    await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(2);
    await window.screenshot({ path: test.info().outputPath('graph-light.png') });
    await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click(); });
    await expect(graph).toHaveAttribute('theme', 'dark');
    await window.screenshot({ path: test.info().outputPath('graph-dark.png') });
    await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.getMenuItemById('preview-theme-github-light')?.click(); });
    await expect(graph).toHaveAttribute('theme', 'light');

    const before = (await pane.boundingBox())!;
    const handle = (await separator.boundingBox())!;
    await window.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await window.mouse.down(); await window.mouse.move(handle.x + handle.width / 2, handle.y - 65, { steps: 6 }); await window.mouse.up();
    expect((await pane.boundingBox())!.height).toBeGreaterThan(before.height + 40);
    await separator.press('ArrowDown');
    const toggle = pane.getByRole('button', { name: 'Graph', exact: true });
    await toggle.click(); await expect(graph).toHaveCount(0);
    await expect(pane.getByRole('button')).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click(); await expect(graph.locator('.row')).toHaveCount(2);
    await graph.locator(`.row[data-oid="${second}"]`).click();
    await graph.locator('.tree-file').click();
    const modified = window.locator('.modified-in-monaco-diff-editor');
    await expect(modified.locator('.view-lines')).toContainText('Second revision');
    await expect(window.locator('.original-in-monaco-diff-editor .view-lines')).toContainText('First revision');
    await expect(window.locator('.git-diff-tab')).toContainText(second.slice(0, 8));
    await window.screenshot({ path: test.info().outputPath('git-history.png') });
    await modified.getByRole('textbox').press('Control+End');
    await modified.getByRole('textbox').pressSequentially('MUST NOT EDIT');
    await expect(modified.locator('.view-lines')).not.toContainText('MUST NOT EDIT');
    expect(await readFile(file, 'utf8')).toBe('# Working document\n');
    await window.getByRole('button', { name: 'View Rendered Diff' }).click();
    await expect.poll(async () => ({ visible: await previews(app!).hasVisible(), error: await window.locator('.project-error').allTextContents() })).toEqual({ visible: true, error: [] });
    await expect.poll(() => previews(app!).evaluate<string>('document.body.textContent')).toContain('Second revision');
    await window.getByRole('button', { name: 'View Source Diff' }).click();
    await graph.locator(`.row[data-oid="${first}"]`).click();
    await graph.locator('.tree-file').click();
    await expect(modified.locator('.view-lines')).toContainText('First revision');
    await expect(window.locator('.git-diff-tab')).toHaveCount(2);
    await graph.getByRole('treegrid').press('Escape');
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await git('commit', '-am', 'External commit');
    await expect(graph.locator('.row').filter({ hasText: 'External commit' })).toHaveCount(1);
    // An immutable review keeps its content when the local branch changes.
    await expect(modified.locator('.view-lines')).toContainText('First revision');
    const height = (await pane.boundingBox())!.height;
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await expect(graph.locator('.row')).toHaveCount(3);
    await expect(modified.locator('.view-lines')).toContainText('First revision');
    expect(Math.abs((await pane.boundingBox())!.height - height)).toBeLessThan(2);
    // Exercise the toolbar against a local bare remote, never a real server.
    await exec('git', ['clone', '-b', 'main', remote, peer]);
    await exec('git', ['config', 'user.name', 'Peer'], { cwd: peer });
    await exec('git', ['config', 'user.email', 'peer@example.test'], { cwd: peer });
    await pane.getByRole('button', { name: 'Push', exact: true }).click();
    await expect.poll(async () => (await exec('git', ['rev-parse', 'refs/heads/main'], { cwd: remote })).stdout.trim())
      .toBe((await git('rev-parse', 'HEAD')).stdout.trim());
    await exec('git', ['pull', '--ff-only'], { cwd: peer });
    await writeFile(path.join(peer, 'remote.md'), '# From remote\n');
    await exec('git', ['add', '.'], { cwd: peer });
    await exec('git', ['commit', '-m', 'Remote addition'], { cwd: peer });
    await exec('git', ['push'], { cwd: peer });
    await expect(pane.getByRole('button', { name: 'Fetch', exact: true })).toBeEnabled();
    await pane.getByRole('button', { name: 'Fetch', exact: true }).click();
    await expect(graph.locator('.row').filter({ hasText: 'Remote addition' })).toHaveCount(1);
    await expect(pane.getByRole('button', { name: 'Pull', exact: true })).toBeEnabled();
    await pane.getByRole('button', { name: 'Pull', exact: true }).click();
    await expect.poll(async () => (await git('log', '-1', '--format=%s')).stdout.trim()).toBe('Remote addition');
    expect(await readFile(path.join(root, 'remote.md'), 'utf8')).toBe('# From remote\n');
    await expect(pane.getByRole('button', { name: 'Refresh Git Graph' })).toBeEnabled();
    await pane.getByRole('button', { name: 'Refresh Git Graph' }).click();
    await expect(graph.locator('.row').filter({ hasText: 'Remote addition' })).toHaveCount(1);
    await git('checkout', '-b', 'feature');
    await writeFile(path.join(root, 'feature.md'), 'feature\n');
    await git('add', 'feature.md'); await git('commit', '-m', 'Feature');
    await git('checkout', 'main');
    await writeFile(path.join(root, 'main.md'), 'main\n');
    await git('add', 'main.md'); await git('commit', '-m', 'Main work');
    await git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
    await expect(graph.locator('.row').filter({ hasText: 'Merge feature' })).toHaveCount(1);
    await expect.poll(async () => graph.locator('.row').evaluateAll((rows) =>
      [...rows].map((row) => parseInt((row as HTMLElement).style.getPropertyValue('--setdown-graph-inset'), 10))
        .filter(Number.isFinite).sort((a, b) => a - b)
    )).toEqual(expect.arrayContaining([30, 46]));
    await window.screenshot({ path: test.info().outputPath('graph-bend.png') });
    const longBranch = 'topic/room-for-branch-labels';
    await git('checkout', '-b', longBranch);
    await git('commit', '--allow-empty', '-m', 'A long commit subject that yields its space to the branch label');
    const newest = (await git('rev-parse', 'HEAD')).stdout.trim();
    await pane.getByRole('button', { name: 'Refresh Git Graph' }).click();
    const newestRow = graph.locator(`.row[data-oid="${newest}"]`);
    await expect(newestRow.locator('.ref:visible')).toContainText(longBranch);
    await expect.poll(() => newestRow.evaluate((row) => {
      const badge = row.querySelector<HTMLElement>('.ref');
      const message = row.querySelector<HTMLElement>('.message');
      return badge && message ? {
        fullBranch: badge.scrollWidth <= badge.clientWidth + 1,
        clippedMessage: message.scrollWidth > message.clientWidth + 1
      } : null;
    })).toEqual({ fullBranch: true, clippedMessage: true });
    await window.screenshot({ path: test.info().outputPath('graph-long-branch.png') });
    expect(errors).toEqual([]);
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
    await rm(peer, { recursive: true, force: true });
  }
});
