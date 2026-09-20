/** Real source input cancels pending automatic handoff, not the input itself.
 * Layout/scroll notifications and Escape keyup may arrive after an Escape:
 * those are deliberately NOT cancellation signals.
 */
export function observeReviewSourceInput(
  source: EventTarget,
  activeSource: () => string | null,
  interrupt: (tabId: string) => void,
): () => void {
  const events = ['keydown', 'beforeinput', 'input', 'compositionstart',
    'pointerdown', 'wheel', 'touchstart', 'paste', 'cut', 'drop'];
  const handle = (event: Event) => {
    if (event.type === 'keydown') {
      const key = event as KeyboardEvent;
      if (!key.isComposing && ['Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(key.key)) return;
    }
    const id = activeSource();
    if (id) interrupt(id);
  };
  for (const event of events) source.addEventListener(event, handle, { capture: true, passive: true });
  return () => { for (const event of events) source.removeEventListener(event, handle, true); };
}
