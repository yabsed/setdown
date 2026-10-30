import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
import { IContextMenuService } from 'monaco-editor/platform/contextview/browser/contextView';
import type { IDisposable } from 'monaco-editor';

type ContextMenuEvents = {
  onDidShowContextMenu(listener: () => void): IDisposable;
  onDidHideContextMenu(listener: () => void): IDisposable;
};

let installed = false;

/** Monaco shares its context-menu service across ordinary, diff and cell editors.
 * Use its lifecycle so keyboard menus and submenus keep one balanced native cover. */
export function installMonacoContextMenus(): void {
  if (installed) return;
  installed = true;
  let open = false;
  const visibility = (value: boolean) => {
    if (open === value) return;
    open = value;
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: value }));
  };
  const subscription = StandaloneServices.withServices(() => {
    const service = StandaloneServices.get<ContextMenuEvents>(IContextMenuService);
    const show = service.onDidShowContextMenu(() => visibility(true));
    const hide = service.onDidHideContextMenu(() => visibility(false));
    return { dispose() { show.dispose(); hide.dispose(); visibility(false); } };
  });
  window.addEventListener('beforeunload', () => subscription.dispose(), { once: true });
}
