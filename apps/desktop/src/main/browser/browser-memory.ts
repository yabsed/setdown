import type { MemoryPressure } from '../../core/memory/memory-policy';

export const browserIdleTime = (pressure: MemoryPressure) =>
  pressure === 'critical' ? 30_000 : pressure === 'moderate' ? 120_000 : 600_000;

// Evaluated in an isolated world. Unknown embedded applications and edited
// controls fail closed. Runtime checks (permissions, audio, unload) remain main's.
export const browserMemoryProbe = `(() => {
  if (document.readyState !== 'complete' || document.fullscreenElement || document.pointerLockElement) return null;
  const roots = [document]; let count = 0;
  while (roots.length) {
    const root = roots.pop();
    for (const element of root.querySelectorAll('*')) {
      if (++count > 50000) return null;
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element.matches('iframe, frame, object, embed, canvas, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
      if (element instanceof HTMLMediaElement && (!element.paused || element.srcObject)) return null;
      if (element instanceof HTMLInputElement && (element.value !== element.defaultValue || element.checked !== element.defaultChecked || element.files?.length)) return null;
      if (element instanceof HTMLTextAreaElement && element.value !== element.defaultValue) return null;
      if (element instanceof HTMLSelectElement && [...element.options].some(option => option.selected !== option.defaultSelected)) return null;
    }
  }
  return { x: scrollX, y: scrollY };
})()`;
