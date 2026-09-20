/** Passive viewport changes (including Escape keyup and programmatic layout)
 * are not a decision to keep editing. Only a new user input cancels a request.
 * No preventDefault/stopPropagation: Monaco and IME receive the original event.
 */
export function listenForReviewInteraction(source: EventTarget, cancel: () => void): () => void {
  const events = ['pointerdown', 'wheel', 'touchstart', 'beforeinput', 'input', 'compositionstart'];
  const interact = () => cancel();
  const keydown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (!['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(key)) cancel();
  };
  for (const event of events) source.addEventListener(event, interact, { capture: true, passive: true });
  source.addEventListener('keydown', keydown, { capture: true, passive: true });
  return () => {
    for (const event of events) source.removeEventListener(event, interact, true);
    source.removeEventListener('keydown', keydown, true);
  };
}
