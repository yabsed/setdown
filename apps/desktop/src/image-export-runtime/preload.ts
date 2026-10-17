import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('imageExport', {
  job: () => ipcRenderer.invoke('image-export:job'),
  finish: (bytes: Uint8Array | null, error?: string) => ipcRenderer.send('image-export:finish', bytes, error),
});
