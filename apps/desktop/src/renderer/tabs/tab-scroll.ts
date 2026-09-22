/** Wheel scrolling never selects a tab. Keep native horizontal trackpad deltas. */
export function tabScroll(node: HTMLElement) {
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || node.scrollWidth <= node.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const unit = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? node.clientWidth : 1;
    event.preventDefault();
    node.scrollLeft += delta * unit;
  };
  node.addEventListener('wheel', wheel, { passive: false });
  return { destroy: () => node.removeEventListener('wheel', wheel) };
}
