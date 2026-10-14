import { tabZoomKey, type ZoomSnapshot } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';

/** Editors/previews and terminals follow separate persisted factors. Each
 * scope notifies only its own listeners, so a terminal zoom never resizes
 * Monaco and an editor zoom never refits a PTY grid. */
let factor = 1;
let terminalFactorValue = 1;
let revision = -1;
let tabs: Record<string, number> = {};
const listeners = new Set<(id?: string) => void>();
const terminalListeners = new Set<(id?: string) => void>();
function update(value: ZoomSnapshot) {
  if (!value || value.revision < revision) return;
  revision = value.revision;
  const next = value.tabs ?? {};
  const changed = new Set([...Object.keys(tabs), ...Object.keys(next)].filter(id => tabs[id] !== next[id]));
  tabs = next;
  for (const id of changed) {
    for (const listener of listeners) listener(id);
    for (const listener of terminalListeners) listener(id);
  }
  if (factor !== value.text / 100) {
    factor = value.text / 100;
    for (const listener of listeners) listener();
  }
  const terminal = (value.terminal ?? value.text) / 100;
  if (terminalFactorValue !== terminal) {
    terminalFactorValue = terminal;
    for (const listener of terminalListeners) listener();
  }
}
// Subscribe before requesting the snapshot; revision ordering also covers reloads.
export function installTextZoom(desktop: DesktopPort, changed?: (value: ZoomSnapshot) => void) {
  const apply = (value: ZoomSnapshot) => {
    if (!value || value.revision < revision) return;
    update(value);
    changed?.(value);
  };
  const unsubscribe = desktop.onZoomChanged(apply);
  void desktop.getZoom().then(apply);
  return unsubscribe;
}
export function textZoomFactor(id?: string) { return id ? (tabs[tabZoomKey(id)] ?? 100) / 100 : factor; }
export function terminalZoomFactor(id?: string) { return id ? textZoomFactor(id) : terminalFactorValue; }
export function textZoomOptions(id?: string) { const size = textZoomFactor(id); return { fontSize: 14 * size, lineHeight: 22 * size }; }
export function onTextZoom(listener: (id?: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function onTerminalZoom(listener: (id?: string) => void) {
  terminalListeners.add(listener);
  return () => { terminalListeners.delete(listener); };
}
