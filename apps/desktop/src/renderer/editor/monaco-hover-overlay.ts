import type * as Monaco from 'monaco-editor';

let installed = false;

/** Use the same native cover as Monaco context menus. The existing popup keeps
 * its position, size, scrolling and links above adjacent browser/reader views. */
export function installMonacoHovers(api: typeof Monaco): void {
  if (installed) return;
  installed = true;
  const subscription = api.editor.onDidCreateEditor(view => {
    let open = false;
    const visibility = (value: boolean) => {
      if (value === open) return;
      open = value;
      window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: value }));
    };
    // Monaco exposes no public hover visibility event. Observe only its overflow
    // widgets, not source lines or the shell. A model replacement recreates that
    // container, including an initially empty editor receiving its first model.
    const observer = new MutationObserver(sync);
    let widgets: Element | null = null;
    function sync() {
      visibility([...widgets?.querySelectorAll('.monaco-resizable-hover') ?? []]
        .some(popup => popup.checkVisibility({ visibilityProperty: true })));
    }
    function bind() {
      observer.disconnect();
      const node = view.getDomNode();
      // Notebook cells share one overflow container. This runs as the view is
      // created, so this editor's widgets are the ones Monaco appended last.
      widgets = node?.querySelector('.overflowingContentWidgets')
        ?? [...node?.closest('.notebook-surface')?.querySelectorAll(':scope > .notebook-overflow-widgets > .overflowingContentWidgets') ?? []].at(-1) ?? null;
      if (widgets) observer.observe(widgets, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class'] });
      sync();
    }
    const model = view.onDidChangeModel(bind);
    bind();
    view.onDidDispose(() => { observer.disconnect(); model.dispose(); visibility(false); });
  });
  window.addEventListener('beforeunload', () => subscription.dispose(), { once: true });
}
