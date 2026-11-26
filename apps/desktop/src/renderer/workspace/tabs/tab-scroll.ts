/**
 * Scrolls a row sideways by a wheel event: a mouse wheel turns into a sideways scroll, a trackpad's
 * own sideways delta is kept. Returns whether the event was taken. Ctrl/Cmd+wheel stays a zoom.
 */
export function scrollSideways(node: HTMLElement, event: WheelEvent): boolean {
  if (event.ctrlKey || event.metaKey || node.scrollWidth <= node.clientWidth) return false;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return false;
  const unit = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? node.clientWidth : 1;
  event.preventDefault();
  node.scrollLeft += delta * unit;
  return true;
}

/** Wheel scrolling never selects a tab. Keep native horizontal trackpad deltas. */
export function tabScroll(node: HTMLElement) {
  const wheel = (event: WheelEvent) => { scrollSideways(node, event); };
  node.addEventListener('wheel', wheel, { passive: false });
  return { destroy: () => node.removeEventListener('wheel', wheel) };
}
