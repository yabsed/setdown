import { contextBridge, ipcRenderer } from 'electron';

// The hidden export window gets its one document and reports when it is laid out for paper. Nothing else is exposed.
contextBridge.exposeInMainWorld('officeExport', {
  job: () => ipcRenderer.invoke('office-export:job'),
  finish: (error?: string) => ipcRenderer.send('office-export:finish', error),
});
