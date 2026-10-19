import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Run from the repository root through apps/desktop/scripts/with-isolated-display.sh.
// Observes the current production build; no kernels run and no app source is modified.
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw new Error('Use the isolated display wrapper.');
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-readability-'));
const source = '오류는 고정된 분류와 건수로만 요약한다. other_error의 상세 원인은 내부 오류 파일에서 확인한다. 건수는 오류 내역 수이며, 같은 기록이 여러 번 포함될 수 있다. 이 설명을 읽은 뒤 아래 코드와 실행 결과를 함께 확인한다.';
const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
  { id: 'explanation', cell_type: 'markdown', metadata: {}, source: `## 출력에 남기는 오류 정보\n\n${source}` },
  { id: 'classification', cell_type: 'code', metadata: {}, execution_count: 32, outputs: [], source:
    'def issue_category(reason):\n    # Match known phrases; return only fixed labels.\n    # 오류 원문 대신 정해진 분류만 반환한다.\n    text = str(reason)\n    if "FileNotFoundError" in text:\n        return "missing_input"\n    return "other_error"' },
  { id: 'results', cell_type: 'code', metadata: {}, execution_count: 33, source: 'evaluation_table = pd.DataFrame(evaluation_rows).set_index("Model")\nevaluation_table.round(3)', outputs: [
    { output_type: 'execute_result', execution_count: 33, metadata: {}, data: {
      'text/plain': 'Model                 Train RMSE (μs)  Test RMSE (μs)\nTwo-line (99%)                 2.133           2.117\nAffine                        3.881           3.880',
      'text/html': '<style>.dataframe { font-family: sans-serif; }</style><table class="dataframe"><thead><tr><th>Model</th><th>Train RMSE (μs)</th><th>Test RMSE (μs)</th><th>Test MAPE (%)</th></tr></thead><tbody><tr><th>Two-line (efficiency)</th><td>2.185</td><td>2.169</td><td>3.927</td></tr><tr><th>Two-line (99%)</th><td>2.133</td><td>2.117</td><td>3.744</td></tr><tr><th>Hinge</th><td>1.804</td><td>1.765</td><td>2.727</td></tr><tr><th>Affine</th><td>3.881</td><td>3.880</td><td>4.473</td></tr></tbody></table>'
    } }
  ] },
  { id: 'conclusion', cell_type: 'markdown', metadata: {}, source: '### 결과를 읽는 방법\n\n작은 값이 더 좋은 결과를 뜻한다. **비교 기준**을 먼저 확인하고, 같은 조건에서 계산한 결과인지 확인한다. `evaluation_table`은 위 셀에서 만든 결과다.' }
] };
await writeFile(path.join(directory, 'fixture.ipynb'), JSON.stringify(notebook, null, 2) + '\n');
const fixture = path.join(temporary, 'readability.ipynb');
await writeFile(fixture, JSON.stringify(notebook));
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const app = await _electron.launch({ executablePath: require('electron'), chromiumSandbox: true,
  cwd: path.join(root, 'apps/desktop'), args: ['.', fixture], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
const results = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  capturedAt: new Date().toISOString(),
  sourceDiffHash: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: root })).digest('hex'),
  fixture: 'fixture.ipynb', note: 'Controlled fixture, not a recreation or measurement of the user screenshots. CSS pixels; app and tab zoom 100%.', captures: [] };
try {
  const page = await app.firstWindow();
  await expect(page.locator('.notebook-cell')).toHaveCount(4);
  await expect(page.locator('.cell-markdown h2')).toHaveText('출력에 남기는 오류 정보');
  await expect(page.locator('[data-cell-id="classification"] .view-lines')).toContainText('Match known phrases');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  for (const theme of ['one-dark', 'github-dark', 'github-light']) {
    await app.evaluate(({ Menu }, theme) => Menu.getApplicationMenu().getMenuItemById(`preview-theme-${theme}`).click(), theme);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim()))
      .toBe({ 'one-dark': '#282c34', 'github-dark': '#24292e', 'github-light': '#ffffff' }[theme]);
    for (const width of [1440, 720]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1000), width);
      await page.mouse.move(1, 1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350); // let ResizeObserver and Monaco's layout settle before the single capture
      const measured = await page.evaluate(() => {
        const rect = element => element?.getBoundingClientRect().toJSON();
        const css = element => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return Object.fromEntries(['fontFamily', 'fontSize', 'lineHeight', 'fontStyle', 'color', 'backgroundColor', 'textAlign', 'maxWidth', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom', 'opacity', 'borderTopWidth', 'position', 'display', 'wordBreak'].map(key => [key, style[key]]));
        };
        const q = selector => document.querySelector(selector);
        const paragraph = q('[data-cell-id="explanation"] .cell-markdown p');
        const lines = new Map();
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          for (let i = 0; i < text.textContent.length; i++) {
            const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
            const box = range.getBoundingClientRect();
            const key = Math.round(box.top * 10) / 10;
            lines.set(key, (lines.get(key) ?? '') + text.textContent[i]);
          }
        }
        const comment = [...document.querySelectorAll('[data-cell-id="classification"] .view-lines span')].find(element => element.childElementCount === 0 && /^#\s*Match/.test(element.textContent));
        return {
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          canvas: css(q('.notebook-surface')), scroll: { rect: rect(q('.notebook-scroll')), style: css(q('.notebook-scroll')) },
          toolbar: { rect: rect(q('.notebook-toolbar')), style: css(q('.notebook-toolbar')) },
          paragraph: { rect: rect(paragraph), style: css(paragraph), lines: [...lines.values()].map(text => ({ text, characters: text.length, hangul: (text.match(/[가-힣]/g) ?? []).length })) },
          heading: css(q('.cell-markdown h2')), code: css(q('.view-lines')), comment: { text: comment?.textContent, style: css(comment) },
          focus: { tag: document.activeElement?.tagName, className: document.activeElement?.className },
          currentLines: [...document.querySelectorAll('.notebook-cell .current-line')].map(element => ({ cell: element.closest('[data-cell-id]')?.getAttribute('data-cell-id'), style: css(element), rect: rect(element), focused: element.closest('.monaco-editor')?.contains(document.activeElement) })),
          table: { rect: rect(q('.output-html table')), style: css(q('.output-html td')), styleTags: document.querySelectorAll('.output-html style').length },
          cells: [...document.querySelectorAll('.notebook-cell')].map(cell => ({ id: cell.dataset.cellId, kind: cell.dataset.cellKind, rect: rect(cell),
            toolbar: rect(cell.querySelector('.cell-toolbar')), toolbarStyle: css(cell.querySelector('.cell-toolbar')), body: rect(cell.querySelector('.cell-markdown, .cell-editor')),
            outputToolbar: rect(cell.querySelector('.output-toolbar')), outputActions: rect(cell.querySelector('.output-actions')), outputFormat: rect(cell.querySelector('.notebook-outputs > select')),
            actionVisibility: css(cell.querySelector('.cell-actions'))?.opacity,
            controlBoxes: [...cell.querySelectorAll('.cell-toolbar button, .cell-toolbar select')].map(control => ({ name: control.getAttribute('aria-label') || control.textContent, rect: rect(control) })) }))
        };
      });
      const fonts = {};
      const { root: documentRoot } = await cdp.send('DOM.getDocument');
      for (const [name, selector] of Object.entries({ paragraph: '.cell-markdown p', code: '[data-cell-id="classification"] .view-lines .view-line > span > span', ui: '.cell-toolbar select', table: '.output-html td' })) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector });
        fonts[name] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
      }
      const name = `${theme}-${width}`;
      await page.screenshot({ path: path.join(directory, `${name}.png`) });
      results.captures.push({ name, theme, ...measured, fonts });
    }
  }
  await writeFile(path.join(directory, 'evidence.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.captures.map(c => ({ name: c.name, paragraphWidth: c.paragraph.rect.width,
    font: c.paragraph.style.fontFamily, lines: c.paragraph.lines.length, toolbarHeight: c.toolbar.rect.height,
    cellHeights: c.cells.map(cell => [cell.id, cell.rect.height, cell.toolbar.height]), comment: c.comment.style?.color })), null, 2));
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {}); await rm(temporary, { recursive: true, force: true });
}
