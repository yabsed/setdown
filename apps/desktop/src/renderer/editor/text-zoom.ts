import type { ZoomSnapshot } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';

/** Editors/previews and terminals follow separate persisted factors. Each
 * scope notifies only its own listeners, so a terminal zoom never resizes
 * Monaco and an editor zoom never refits a PTY grid. */
let factor = 1;
let terminalFactorValue = 1;
let revision = -1;
const listeners = new Set<() => void>();
const terminalListeners = new Set<() => void>();
function update(value: ZoomSnapshot) {
  if (!value || value.revision < revision) return;
  revision = value.revision;
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
export function installTextZoom(desktop: DesktopPort) {
  const unsubscribe = desktop.onZoomChanged(update);
  void desktop.getZoom().then(update);
  return unsubscribe;
}
export function textZoomFactor() { return factor; }
export function terminalZoomFactor() { return terminalFactorValue; }
export function textZoomOptions() { return { fontSize: 14 * factor, lineHeight: 22 * factor }; }
export function onTextZoom(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function onTerminalZoom(listener: () => void) {
  terminalListeners.add(listener);
  return () => { terminalListeners.delete(listener); };
}
