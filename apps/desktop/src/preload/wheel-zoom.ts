import { ContentZoomInput, type ContentZoomChange } from '../core/wheel-zoom';
import { appZoomStep } from '../core/zoom';
export { WheelZoomAccumulator } from '../core/wheel-zoom';

export type WheelZoomScope = 'text' | 'terminal';

/** Which persisted factor a shell wheel target owns. Media surfaces handle
 * their own cursor-anchored zoom, including shadow DOM; all surfaces use their owning tab ID. */
export function wheelZoomScope(target: EventTarget | null): WheelZoomScope | null {
  const element = target as Element | null;
  if (element?.closest?.('.pdf-host, .image-viewport')) return null;
  if (element?.closest?.('.terminal-surface')) return 'terminal';
  return element?.closest?.('.monaco-editor, .web-reader, .notebook-surface, .video-surface') ? 'text' : null;
}

export function isTextZoomTarget(target: EventTarget | null): boolean {
  return wheelZoomScope(target) !== null;
}

/** Installed in sandbox preloads, before editor, document or page handlers.
 * Do not expose ipcRenderer to page scripts. Synthetic wheel events are ignored.
 * Native text/page preloads always report the `text` scope; only the shell
 * routes terminal steps to their own channel.
 */
export function installWheelZoom(send: (steps: ContentZoomChange, scope: WheelZoomScope, tabId?: string) => void, nativeText = false): () => void {
  let accumulator = new ContentZoomInput();
  let previousOwner: Element | null = null;
  let previousTab: string | undefined;
  const wheel = (event: WheelEvent) => {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const scope = nativeText ? 'text' : wheelZoomScope(event.target);
    if (!scope) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const owner = nativeText ? document.documentElement
      : (event.target as Element | null)?.closest<HTMLElement>('[data-zoom-tab]') ?? null;
    const tabId = nativeText ? undefined : (owner as HTMLElement | null)?.dataset.zoomTab;
    if (owner !== previousOwner || tabId !== previousTab) {
      accumulator = new ContentZoomInput(); previousOwner = owner; previousTab = tabId;
    }
    const steps = accumulator.consume(event, performance.now());
    if (steps) send(steps, scope, tabId);
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
