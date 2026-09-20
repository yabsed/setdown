import type * as Monaco from 'monaco-editor';

/** Markdown commands are unavailable in plain text, including context menus. */
export function installMarkdownEditorActions(api: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  actions: { insertLink(): void; insertTable(): void },
  canEdit: () => boolean = () => true): Monaco.IDisposable {
  const capability = editor.createContextKey('setdownMarkdownDocument', false);
  const update = () => capability.set(editor.getModel()?.getLanguageId() === 'markdown');
  const precondition = 'setdownMarkdownDocument && !editorReadonly && !compositionInProgress';
  const installed = [editor.onDidChangeModel(update), editor.onDidChangeModelLanguage(update),
    editor.addAction({ id: 'setdown.insertLink', label: 'Insert URL',
      keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.KeyK],
      contextMenuGroupId: '1_modification', precondition,
      run: () => { if (capability.get() && canEdit()) actions.insertLink(); },
    }), editor.addAction({ id: 'setdown.insertTable', label: 'Insert Table',
      contextMenuGroupId: '1_modification', precondition,
      run: () => { if (capability.get() && canEdit()) actions.insertTable(); },
    })];
  update();
  return { dispose() { installed.forEach((action) => action.dispose()); capability.reset(); } };
}
