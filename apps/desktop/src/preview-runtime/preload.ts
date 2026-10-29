import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { installAppZoom, installWheelZoom } from '../preload/wheel-zoom';

installAppZoom((steps) => ipcRenderer.send('workspace:zoom', steps));
installWheelZoom((steps) => ipcRenderer.send('workspace:text-zoom', steps), true);

contextBridge.exposeInMainWorld('marktexPreviewHost', {
  send: (message: Record<string, unknown>) => ipcRenderer.send('preview:message', message),
});

ipcRenderer.on('preview:command', (_event, message: Record<string, unknown>) => {
  window.postMessage(message, '*');
});

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');
const showFolderDrop = (visible: boolean) => {
  document.documentElement?.toggleAttribute('data-setdown-folder-drop', visible);
};
window.addEventListener('dragend', () => showFolderDrop(false), true);
window.addEventListener('blur', () => showFolderDrop(false));
window.addEventListener('keydown', event => { if (event.key === 'Escape') showFolderDrop(false); }, true);

window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  showFolderDrop(true);
}, { capture: true });
window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) showFolderDrop(false);
}, { capture: true });
window.addEventListener('drop', (event) => {
  showFolderDrop(false);
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  showFolderDrop(false);
  const paths = [...event.dataTransfer?.files ?? []].map(file => webUtils.getPathForFile(file)).filter(Boolean);
  if (paths.length) ipcRenderer.send('preview:message', {
    source: 'crossnote', type: 'marktex:folder-drop', path: paths[0], paths,
  });
}, { capture: true });
