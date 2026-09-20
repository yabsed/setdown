import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { installWheelZoom } from '../preload/wheel-zoom';

installWheelZoom((steps) => ipcRenderer.send('workspace:zoom', steps));

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
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  showFolderDrop(false);
  const file = event.dataTransfer?.files.item(0);
  if (!file) return;
  const path = webUtils.getPathForFile(file);
  if (path) ipcRenderer.send('preview:message', {
    source: 'crossnote', type: 'marktex:folder-drop', path,
  });
}, { capture: true });
