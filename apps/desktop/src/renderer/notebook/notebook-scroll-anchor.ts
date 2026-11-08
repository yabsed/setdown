/** Keep the visible cell in place when earlier virtual cells finish measuring.
 * Browser anchoring can pick a Monaco child that is retired on the next frame;
 * the stable cell wrapper survives editor and output virtualization. */
export function anchorNotebookScroll(scroll: HTMLElement): () => void {
  let anchor: { node: HTMLElement; top: number } | undefined;
  let adjustedTop: number | undefined;
  const remember = () => {
    if (adjustedTop !== undefined && Math.abs(scroll.scrollTop - adjustedTop) < 1) { adjustedTop = undefined; return; }
    adjustedTop = undefined;
    if (!scroll.clientHeight || scroll.scrollTop <= 0) { anchor = undefined; return; }
    const viewport = scroll.getBoundingClientRect();
    let candidate: { node: HTMLElement; top: number; distance: number } | undefined;
    const center = viewport.top + scroll.clientHeight / 2;
    for (const node of scroll.querySelectorAll<HTMLElement>(':scope > .cell-drop')) {
      const bounds = node.getBoundingClientRect();
      if (bounds.height && bounds.bottom > viewport.top && bounds.top < viewport.bottom) {
        const distance = Math.max(bounds.top - center, center - bounds.bottom, 0);
        if (!candidate || distance < candidate.distance) candidate = { node, top: bounds.top - viewport.top, distance };
      }
    }
    anchor = candidate;
  };
  const resize = new ResizeObserver(() => {
    if (!scroll.clientHeight || !anchor?.node.isConnected || anchor.node.hidden) return;
    const next = anchor.node.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    const delta = next - anchor.top;
    if (Math.abs(delta) < .5) return;
    scroll.scrollTop += delta;
    adjustedTop = scroll.scrollTop;
  });
  const observed = new Set<Element>();
  const observe = () => {
    for (const node of observed) if (!node.isConnected) { resize.unobserve(node); observed.delete(node); }
    for (const node of scroll.querySelectorAll(':scope > .cell-drop')) if (!observed.has(node)) { observed.add(node); resize.observe(node); }
  };
  const mutations = new MutationObserver(observe);
  mutations.observe(scroll, { childList: true }); observe();
  scroll.addEventListener('scroll', remember, { passive: true });
  return () => { resize.disconnect(); mutations.disconnect(); scroll.removeEventListener('scroll', remember); };
}
