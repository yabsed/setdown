import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('extensionPanel', {
  context: () => ipcRenderer.invoke('extension-panel:context'),
  choose: (id: string) => ipcRenderer.invoke('extension-panel:choose', id),
});
