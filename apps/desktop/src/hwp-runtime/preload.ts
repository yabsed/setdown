import { contextBridge, ipcRenderer } from 'electron';
import type { HwpArtifact } from '../protocol/hwp';
contextBridge.exposeInMainWorld('setdownHwp', {
  load: () => ipcRenderer.invoke('hwp-runtime:load'),
  state: (value: { revision: number; ready: boolean; error?: string; position?: import('../core/reading/reading-position').HwpReadingPosition }) => ipcRenderer.send('hwp-runtime:state', value),
  action: (command: 'save' | 'save-as' | 'focus') => ipcRenderer.send('hwp-runtime:action', command),
  onExport: (listener: (request: { request: string; format: 'hwp' | 'hwpx' }) => Promise<{ artifact?: HwpArtifact; error?: string; position?: import('../core/reading/reading-position').HwpReadingPosition }>) => {
    ipcRenderer.on('hwp-runtime:export', (_event, request) => { void listener(request).then(result =>
      ipcRenderer.send('hwp-runtime:exported', { request: request.request, ...result })).catch(error =>
      ipcRenderer.send('hwp-runtime:exported', { request: request.request, error: String(error) })); });
  },
  onSaved: (listener: (value: { revision: number; name: string }) => void) => ipcRenderer.on('hwp-runtime:saved', (_event, value) => listener(value)),
  onZoom: (listener: (steps: number) => void) => ipcRenderer.on('hwp-runtime:zoom', (_event, value) => listener(value)),
  onCommand: (listener: (command: string) => void) => ipcRenderer.on('hwp-runtime:command', (_event, value) => listener(value)),
});
