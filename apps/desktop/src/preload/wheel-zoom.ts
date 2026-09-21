import { WheelZoomAccumulator } from '../core/wheel-zoom';
import { appZoomStep } from '../core/zoom';
export { WheelZoomAccumulator } from '../core/wheel-zoom';

/** Installed in BOTH sandbox preloads, before Monaco or document handlers.
 * Do not expose ipcRenderer to page scripts. Synthetic wheel events are ignored.
 */
export function installWheelZoom(send: (steps: number) => void, nativeText = false): () => void {
  const accumulator = new WheelZoomAccumulator();
  const wheel = (event: WheelEvent) => {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    if (!nativeText) {
      const target = event.target as Element;
      // Media surfaces handle their own cursor-anchored zoom, including shadow DOM.
      if (target.closest?.('.pdf-host, .image-viewport')) return;
      if (!target.closest?.('.monaco-editor')) return;
    }
    event.stopImmediatePropagation();
    const steps = accumulator.consume(event, performance.now());
    if (steps) send(steps);
  };
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  return () => {
    window.removeEventListener('wheel', wheel, true);
  };
}

/** Also handles trusted Chromium/CDP keyboard input which can bypass Electron's
 * before-input-event. Native input is prevented there and never reaches this. */
export function installAppZoom(send: (steps: number) => void): void {
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const steps = appZoomStep({ type: 'keyDown', key: event.key, control: event.ctrlKey,
      alt: event.altKey, meta: event.metaKey, shift: event.shiftKey, isComposing: event.isComposing });
    if (steps === undefined) return;
    event.preventDefault(); event.stopImmediatePropagation(); send(steps);
  }, { capture: true });
}
