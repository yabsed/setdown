# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> new staged and working-tree reviews open source diff at the first change
- Location: ../../../../../apps/desktop/test/e2e/git/git-review-tabs.spec.ts:48:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.modified-in-monaco-diff-editor .view-lines')
Expected substring: "Working tree change"
Error: strict mode violation: locator('.modified-in-monaco-diff-editor .view-lines') resolved to 2 elements:
    1) <div data-mprt="8" aria-hidden="true" role="presentation" class="view-lines monaco-mouse-cursor-text">…</div> aka getByText('Shared preface 20Shared').nth(2)
    2) <div data-mprt="8" aria-hidden="true" role="presentation" class="view-lines monaco-mouse-cursor-text">…</div> aka getByText('Shared preface 15Shared').nth(2)

Call log:
  - Expect "toContainText" locator('.modified-in-monaco-diff-editor .view-lines') with timeout 5000ms
  - waiting for locator('.modified-in-monaco-diff-editor .view-lines')

```

# Test source

```ts
  22  | function diffPreviews(application: Application) {
  23  |   return application.evaluate(async ({ BrowserWindow }) => {
  24  |     const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
  25  |     if (!owner) return [];
  26  |     const rows = await Promise.all(owner.contentView.children.map(async (candidate) => {
  27  |       if (!('webContents' in candidate)) return null;
  28  |       const contents = candidate.webContents as Electron.WebContents;
  29  |       const url = contents.getURL();
  30  |       if (!url.startsWith('marktex-preview://document/')) return null;
  31  |       const renderedDiff = await contents.executeJavaScript(
  32  |         'Boolean(document.querySelector(".setdown-rendered-diff-split"))',
  33  |       ).catch(() => false);
  34  |       return renderedDiff ? {
  35  |         id: contents.id,
  36  |         url,
  37  |         visible: candidate.getVisible(),
  38  |         scrollY: await contents.executeJavaScript('window.scrollY')
  39  |           .catch(() => 0),
  40  |         text: await contents.executeJavaScript('document.body.innerText')
  41  |           .catch(() => ''),
  42  |       } : null;
  43  |     }));
  44  |     return rows.filter((row): row is NonNullable<typeof row> => !!row);
  45  |   });
  46  | }
  47  | 
  48  | test('new staged and working-tree reviews open source diff at the first change', async () => {
  49  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-position-'));
  50  |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-position-config-'));
  51  |   const documentPath = path.join(root, 'review.md');
  52  |   const unchanged = Array.from({ length: 45 }, (_, index) => `Shared preface ${index + 1}`);
  53  |   await exec('git', ['init'], { cwd: root });
  54  |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  55  |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  56  |   await writeFile(documentPath, [
  57  |     '# Shared document', '', ...unchanged, '', '# Base', '', 'Tail', '',
  58  |   ].join('\n'), 'utf8');
  59  |   await exec('git', ['add', 'review.md'], { cwd: root });
  60  |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  61  |   await writeFile(documentPath, [
  62  |     '# Shared document', '', ...unchanged, '', '# Staged', '', 'Tail', '',
  63  |   ].join('\n'), 'utf8');
  64  |   await exec('git', ['add', 'review.md'], { cwd: root });
  65  |   await writeFile(documentPath, [
  66  |     '# Shared document', '', ...unchanged, '', '# Staged', '', 'Working tree change', '',
  67  |     'Tail', '',
  68  |   ].join('\n'), 'utf8');
  69  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  70  |   const application = await electron.launch({
  71  |     args: ['.', documentPath],
  72  |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  73  |   });
  74  | 
  75  |   try {
  76  |     const window = await application.firstWindow();
  77  |     await window.evaluate(async (folderPath) => {
  78  |       await (window as typeof window & {
  79  |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  80  |       }).marktex.restoreProjectFolder(folderPath);
  81  |     }, root);
  82  |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  83  |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  84  |     await window.getByRole('button', { name: 'Source Control' }).click();
  85  |     const refreshSourceControl = window.getByRole('button', { name: 'Refresh Source Control' });
  86  |     await refreshSourceControl.evaluate((button) => {
  87  |       const states: boolean[] = [];
  88  |       (window as typeof window & { refreshDisabledStates?: boolean[] }).refreshDisabledStates = states;
  89  |       new MutationObserver(() => states.push((button as HTMLButtonElement).disabled))
  90  |         .observe(button, { attributes: true, attributeFilter: ['disabled'] });
  91  |     });
  92  |     await refreshSourceControl.click();
  93  |     await window.waitForTimeout(250);
  94  |     expect(await window.evaluate(() =>
  95  |       (window as typeof window & { refreshDisabledStates?: boolean[] }).refreshDisabledStates))
  96  |       .not.toContain(true);
  97  | 
  98  |     const staged = window.locator('.scm-group').filter({
  99  |       has: window.getByText('STAGED CHANGES', { exact: true }),
  100 |     });
  101 |     const changed = window.locator('.scm-group').filter({
  102 |       has: window.getByText('CHANGES', { exact: true }),
  103 |     });
  104 |     await staged.getByRole('button', { name: 'Collapse STAGED CHANGES' }).click();
  105 |     await expect(staged.locator('.git-changes')).toHaveCount(0);
  106 |     await staged.getByRole('button', { name: 'Expand STAGED CHANGES' }).click();
  107 |     await expect(staged.locator('.git-changes')).toBeVisible();
  108 |     await changed.getByRole('button', { name: 'Collapse CHANGES' }).click();
  109 |     await expect(changed.locator('.git-changes')).toHaveCount(0);
  110 |     await changed.getByRole('button', { name: 'Expand CHANGES' }).click();
  111 |     await expect(changed.locator('.git-changes')).toBeVisible();
  112 |     await staged.locator('.git-change-open').click();
  113 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  114 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  115 |       .toContainText('Base');
  116 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
  117 |       .toContainText('Staged');
  118 | 
  119 |     await changed.locator('.git-change-open').click();
  120 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  121 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
> 122 |       .toContainText('Working tree change');
      |        ^ Error: expect(locator).toContainText(expected) failed
  123 |   } finally {
  124 |     await disposeApplication(application);
  125 |     await rm(root, { recursive: true, force: true });
  126 |     await rm(configRoot, { recursive: true, force: true });
  127 |   }
  128 | });
  129 | 
  130 | test('keeps word wrap in the original diff pane after tab roundtrips', async () => {
  131 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-wrap-'));
  132 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-wrap-config-'));
  133 |   const documentPath = path.join(root, 'wrap.md');
  134 |   const longLine = `Long line: ${'wrap me please '.repeat(30)}`;
  135 |   await exec('git', ['init'], { cwd: root });
  136 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  137 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  138 |   await writeFile(documentPath, `# Base\n\n${longLine}\n`, 'utf8');
  139 |   await exec('git', ['add', 'wrap.md'], { cwd: root });
  140 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  141 |   await writeFile(documentPath, `# Changed\n\n${longLine}\n`, 'utf8');
  142 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  143 |   const application = await electron.launch({
  144 |     args: ['.', documentPath],
  145 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  146 |   });
  147 | 
  148 |   try {
  149 |     const window = await application.firstWindow();
  150 |     // Rendered view lines in the original (left) pane. The model has 3 lines;
  151 |     // with word wrap on, the long line renders as many view lines.
  152 |     const originalViewLineCount = () => window.evaluate(() =>
  153 |       document.querySelectorAll('.original-in-monaco-diff-editor .view-lines > div').length);
  154 |     await window.evaluate(async (folderPath) => {
  155 |       await (window as typeof window & {
  156 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  157 |       }).marktex.restoreProjectFolder(folderPath);
  158 |     }, root);
  159 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  160 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  161 |     await window.getByRole('button', { name: 'Source Control' }).click();
  162 |     const changed = window.locator('.scm-group').filter({
  163 |       has: window.getByText('CHANGES', { exact: true }),
  164 |     });
  165 |     await changed.locator('.git-change-open').click();
  166 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  167 |       .toContainText('Long line:');
  168 | 
  169 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
  170 |       .toBeGreaterThan(5);
  171 | 
  172 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  173 |     await expect(window.locator('.git-diff-editor')).toBeHidden();
  174 |     await window.locator('.git-diff-tab').click();
  175 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  176 |       .toContainText('Long line:');
  177 | 
  178 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
  179 |       .toBeGreaterThan(5);
  180 |   } finally {
  181 |     await disposeApplication(application);
  182 |     await rm(root, { recursive: true, force: true });
  183 |     await rm(configRoot, { recursive: true, force: true });
  184 |   }
  185 | });
  186 | 
  187 | test('keeps staged and live working-tree reviews in separate tabs', async () => {
  188 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-tabs-'));
  189 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-config-'));
  190 |   const documentPath = path.join(root, 'review.md');
  191 |   await exec('git', ['init'], { cwd: root });
  192 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  193 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  194 |   await writeFile(documentPath, '# Base\n', 'utf8');
  195 |   await exec('git', ['add', 'review.md'], { cwd: root });
  196 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  197 |   const filler = Array.from({ length: 90 }, (_, index) => `Filler paragraph ${index + 1}`);
  198 |   await writeFile(documentPath, [
  199 |     '# Staged', '', 'line one', 'line two', 'Working tree', '', 'Tail', '', ...filler, '',
  200 |   ].join('\n'), 'utf8');
  201 |   await exec('git', ['add', 'review.md'], { cwd: root });
  202 |   await writeFile(documentPath, [
  203 |     '# Staged', '', 'line one', 'line two', 'Working tree ?', '',
  204 |     'Inserted one', '', 'Inserted two', '', 'Tail', '', ...filler, '',
  205 |   ].join('\n'), 'utf8');
  206 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  207 |   const application = await electron.launch({
  208 |     args: ['.', documentPath],
  209 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  210 |   });
  211 | 
  212 |   try {
  213 |     const window = await application.firstWindow();
  214 |     const reading = previews(application);
  215 |     await window.evaluate(async (folderPath) => {
  216 |       await (window as typeof window & {
  217 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  218 |       }).marktex.restoreProjectFolder(folderPath);
  219 |     }, root);
  220 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  221 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  222 |     await window.getByRole('button', { name: 'Source Control' }).click();
```