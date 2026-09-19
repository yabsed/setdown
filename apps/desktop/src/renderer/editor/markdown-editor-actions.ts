import type * as Monaco from 'monaco-editor';

/** Use the same commands in ordinary Markdown and the writable diff pane. */
export function installMarkdownEditorActions(api: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  actions: { insertLink(): void; insertTable(): void },
  canEdit: () => boolean = () => true): Monaco.IDisposable {
  const precondition = '!editorReadonly && !compositionInProgress';
  const installed = [editor.addAction({
    id: 'setdown.insertLink', label: 'Insert URL',
    keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.KeyK],
    contextMenuGroupId: '1_modification', precondition,
    run: () => { if (canEdit()) actions.insertLink(); },
  }), editor.addAction({
    id: 'setdown.insertTable', label: 'Insert Table',
    contextMenuGroupId: '1_modification', precondition,
    run: () => { if (canEdit()) actions.insertTable(); },
  })];
  return { dispose() { installed.forEach((action) => action.dispose()); } };
}
