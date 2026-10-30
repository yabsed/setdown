import { ipcRenderer } from 'electron';
import type { NativeTabDrag } from '../protocol/tab-drag';
import type { PreviewBounds } from '../protocol/preview-preparation';

let transferId: string | null = null;
ipcRenderer.on('tab-drag-surface:state', (_event, state: { transferId: string | null; guides: PreviewBounds[]; accent?: string }) => {
  transferId = state.transferId;
  const root = document.getElementById('guides');
  if (!root) return;
  if (state.accent) {
    root.style.setProperty('--accent', state.accent);
    root.style.setProperty('--fill', state.accent + '30');
  }
  root.replaceChildren(...state.guides.map(bounds => {
    const guide = document.createElement('div'); guide.className = 'guide';
    Object.assign(guide.style, { left: bounds.x + 'px', top: bounds.y + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
    return guide;
  }));
});
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'] as const) document.addEventListener(type, event => {
  const data = event.dataTransfer;
  if (!event.isTrusted || !transferId || !data?.types.includes('application/x-setdown-tab')) return;
  if (type === 'drop' && data.getData('application/x-setdown-tab') !== transferId) return;
  if (type === 'dragleave' && event.relatedTarget) return;
  if (type !== 'dragleave') {
    event.preventDefault();
    data.dropEffect = (/Mac/.test(navigator.platform) ? event.altKey : event.ctrlKey) ? 'copy' : 'move';
  }
  ipcRenderer.send('tab-drag-surface:event', { transferId, type, clientX: event.clientX, clientY: event.clientY,
    screenX: event.screenX, screenY: event.screenY, ctrlKey: event.ctrlKey, altKey: event.altKey } satisfies NativeTabDrag);
});
