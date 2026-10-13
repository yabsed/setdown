import { WheelZoomAccumulator } from '../core/wheel-zoom';
import { appZoomStep } from '../core/zoom';
export { WheelZoomAccumulator } from '../core/wheel-zoom';

export type WheelZoomScope = 'text' | 'terminal';

/** Which persisted factor a shell wheel target owns. Media surfaces handle
 * their own cursor-anchored zoom, including shadow DOM; terminals keep a
 * factor independent of editors and Markdown previews. */
export function wheelZoomScope(target: EventTarget | null): WheelZoomScope | null {
  const element = target as Element | null;
  if (element?.closest?.('.pdf-host, .image-viewport')) return null;
  if (element?.closest?.('.terminal-surface')) return 'terminal';
  return element?.closest?.('.monaco-editor') ? 'text' : null;
}

export function isTextZoomTarget(target: EventTarget | null): boolean {
  return wheelZoomScope(target) !== null;
}

/** Installed in sandbox preloads, before editor, document or page handlers.
 * Do not expose ipcRenderer to page scripts. Synthetic wheel events are ignored.
 * Native text/page preloads always report the `text` scope; only the shell
 * routes terminal steps to their own channel.
 */
export function installWheelZoom(send: (steps: number, scope: WheelZoomScope) => void, nativeText = false): () => void {
  const accumulators: Record<WheelZoomScope, WheelZoomAccumulator> = {
    text: new WheelZoomAccumulator(), terminal: new WheelZoomAccumulator(),
  };
  const wheel = (event: WheelEvent) => {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const scope = nativeText ? 'text' : wheelZoomScope(event.target);
    if (!scope) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const steps = accumulators[scope].consume(event, performance.now());
    if (steps) send(steps, scope);
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
