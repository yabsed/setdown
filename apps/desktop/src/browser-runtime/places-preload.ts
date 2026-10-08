import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('placesHost', {
  connect: () => {
    // MessagePort is transferable, but cannot be copied through contextBridge.
    ipcRenderer.once('browser:places-port', event => window.postMessage('setdown:places-port', '*', event.ports));
    ipcRenderer.send('browser:places-ready');
  },
});
