import type { TestApplication } from './electron-app';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The harness is shared, but the application and Electron must belong to cwd's
// checkout, including when a PR upgrades Electron. The fixture is harness-owned.
export const cycleElectronExecutable = createRequire(path.resolve('package.json'))('electron') as string;
export const cycleSampleFixture = fileURLToPath(new URL('../fixtures/sample.md', import.meta.url));

/** Pick a visible authored block after Esc timing has ended. Fixed viewport
 * coordinates can hit blank space/scrollbars during the first native layout.
 * This setup is outside double-click timing; delivery remains real CDP input.
 */
export async function doubleClickPreview(app: TestApplication, id: number, review: boolean) {
  return app.evaluate(async ({ webContents }, { id, review }) => {
    const contents = webContents.fromId(id)!;
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const point = await contents.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('.markdown-preview [data-source-line], .markdown-preview [data-source-start], .markdown-preview [data-source-lines]')];
      const points = candidates.flatMap(node => {
        if (${review} && !node.closest('.setdown-rendered-diff-after')) return [];
        const r = node.getBoundingClientRect();
        const left = Math.max(1, r.left), right = Math.min(innerWidth - 2, r.right);
        const top = Math.max(1, r.top), bottom = Math.min(innerHeight - 2, r.bottom);
        if (right - left < 4 || bottom - top < 4) return [];
        const x = Math.round((left + right) / 2), y = Math.round((top + bottom) / 2);
        const hit = document.elementFromPoint(x, y);
        return hit && node.contains(hit) ? [{ x, y, distance: Math.abs(y - innerHeight * .4) }] : [];
      });
      points.sort((a, b) => a.distance - b.distance);
      if (!points.length) throw Error('No visible authored block for double-click');
      window.__cycleInput = [];
      for (const type of ['mousedown', 'mouseup', 'click', 'dblclick'])
        document.addEventListener(type, event => window.__cycleInput.push({type, detail:event.detail, x:event.clientX, y:event.clientY}), {capture:true, once:true});
      return { x:points[0].x, y:points[0].y, width:innerWidth, height:innerHeight };
    })()`);
    contents.debugger.attach('1.3');
    let at = 0;
    try {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      for (const clickCount of [1, 2]) {
        if (clickCount === 2) at = Date.now();
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed', button: 'left', buttons: 1, clickCount, x: point.x, y: point.y });
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased', button: 'left', buttons: 0, clickCount, x: point.x, y: point.y });
      }
    } finally { contents.debugger.detach(); }
    return { at, point };
  }, { id, review });
}
