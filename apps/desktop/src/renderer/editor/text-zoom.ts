import type { ZoomSnapshot } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';

let factor = 1;
let revision = -1;
const listeners = new Set<() => void>();
function update(value: ZoomSnapshot) {
  if (!value || value.revision < revision) return;
  revision = value.revision;
  if (factor === value.text / 100) return;
  factor = value.text / 100;
  for (const listener of listeners) listener();
}
// Subscribe before requesting the snapshot; revision ordering also covers reloads.
export function installTextZoom(desktop: DesktopPort) {
  const unsubscribe = desktop.onZoomChanged(update);
  void desktop.getZoom().then(update);
  return unsubscribe;
}
export function textZoomOptions() { return { fontSize: 14 * factor, lineHeight: 22 * factor }; }
export function onTextZoom(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
