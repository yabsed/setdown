import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
import { IKeybindingService } from 'monaco-editor/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'monaco-editor/platform/contextkey/common/contextkey';

type Context = { getValue(key: string): unknown };
type Bound = { command: string | null; chords: string[]; resolvedKeybinding?: { getLabel(): string | null } };
type Resolver = { getKeybindings(): readonly Bound[]; resolve(context: Context, pressed: string[], chord: string): { kind: number; commandId?: string | null } };

// What the editor says of itself while a person types in it. A key is looked up for that moment:
// the menu or the list that names the key has taken the keyboard by the time it is drawn.
const typing = new Set(['editorTextFocus', 'editorFocus', 'textInputFocus']);
const found = 2; // ResultKind.KbFound

/** The key a person presses in this editor for an action, as the editor itself writes it ("F12",
 * "Ctrl+Shift+O"). The app's own menu and command list show it beside the action, so a key that
 * was rebound or differs by platform is never written by hand.
 *
 * Only a key that runs the action here is named. The editor binds some keys to two actions
 * (Ctrl+F12 is "definition" and "implementations") and gives the key to one of them: the answer
 * is the editor's own, for the place the menu was opened in. Loaded only once the editor is. */
export function actionKeys(target?: Element | null): (id: string) => string | undefined {
  try {
    const resolver = StandaloneServices.get<{ _getResolver(): Resolver }>(IKeybindingService)._getResolver();
    const live = StandaloneServices.get<{ getContext(target: Element | null): Context }>(IContextKeyService).getContext(target ?? null);
    const context: Context = { getValue: key => typing.has(key) || live.getValue(key) };
    const bound = new Map<string, Bound[]>();
    for (const item of resolver.getKeybindings()) if (item.command && item.resolvedKeybinding && item.chords.length) bound.set(item.command, [...(bound.get(item.command) ?? []), item]);
    return id => {
      const items = bound.get(id) ?? [];
      // From the last one bound: that is the one a person or a platform chose over the default.
      for (let index = items.length - 1; index >= 0; index--) {
        const { chords, resolvedKeybinding } = items[index], answer = resolver.resolve(context, chords.slice(0, -1), chords[chords.length - 1]);
        if (answer.kind === found && answer.commandId === id) return resolvedKeybinding!.getLabel() ?? undefined;
      }
      return undefined;
    };
  } catch { return () => undefined; }
}
