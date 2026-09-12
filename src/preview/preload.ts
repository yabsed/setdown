import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('marktexPreviewHost', {
  send: (message: Record<string, unknown>) => ipcRenderer.send('preview:message', message),
});

ipcRenderer.on('preview:command', (_event, message: Record<string, unknown>) => {
  window.postMessage(message, '*');
});
