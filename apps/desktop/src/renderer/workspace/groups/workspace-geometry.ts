/** Native children live outside the DOM and do not follow CSS layout by themselves. */
export function observeWorkspaceGeometry(area: HTMLElement, changed: () => void) {
  const surfaces = '.group-body, .preview-frames';
  const layout = '.editor-group, .group-content, .group-body, .preview-frames';
  let targets: Element[] = [];
  let signature = '';
  const measure = () => JSON.stringify([area, ...area.querySelectorAll(surfaces)].map(element => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height];
  }));
  const check = () => {
    const next = measure();
    if (next === signature) return;
    signature = next;
    changed();
  };
  const sizes = new ResizeObserver(check);
  const positions = new MutationObserver(check);
  function refresh() {
    const next = [area, ...area.querySelectorAll(layout)];
    if (next.length !== targets.length || next.some((element, index) => element !== targets[index])) {
      sizes.disconnect(); positions.disconnect();
      for (const element of next) {
        sizes.observe(element);
        // Observe only layout owners. Monaco/content style mutations must not
        // put geometry work on the typing or hydration path.
        positions.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      targets = next;
    }
    // The caller is already publishing this layout. Suppress duplicate observer
    // delivery while keeping later size AND position changes observable.
    signature = measure();
  }
  refresh();
  window.addEventListener('resize', check);
  return { refresh, dispose() {
    sizes.disconnect(); positions.disconnect(); window.removeEventListener('resize', check);
  } };
}
