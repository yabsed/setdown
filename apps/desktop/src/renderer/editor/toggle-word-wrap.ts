/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See upstream/VSCODE-LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/

// Port of VS Code's workbench/contrib/codeEditor/browser/toggleWordWrap.ts.
// See upstream/NOTICE for the pinned source and the standalone-only adaptations.
import type * as Monaco from 'monaco-editor';
import { EditorAction, registerEditorAction } from 'monaco-editor/editor/browser/editorExtensions';
import { TransientModelProperties } from './transient-model-properties';

type CodeEditor = Monaco.editor.ICodeEditor & { readonly isSimpleWidget?: boolean };
interface ActiveCodeEditor extends CodeEditor { getModel(): Monaco.editor.ITextModel }
// Standalone Monaco strips VS Code's renderSideBySide getter. Read the same
// computed observable as that getter, including automatic inline layouts.
type DiffEditor = Monaco.editor.IDiffEditor & { readonly _options: { renderSideBySide: { get(): boolean } } };
interface CodeEditorService {
  setTransientModelProperty(model: Monaco.editor.ITextModel, key: string, value: unknown): void;
  getTransientModelProperty(model: Monaco.editor.ITextModel, key: string): unknown;
  onDidChangeTransientModelProperty(listener: () => void): Monaco.IDisposable;
  listDiffEditors(): DiffEditor[];
}

const transientWordWrapState = 'transientWordWrapState';
interface IWordWrapTransientState {
  readonly wordWrapOverride: 'on' | 'off';
}

function writeTransientState(model: Monaco.editor.ITextModel, state: IWordWrapTransientState | null, codeEditorService: CodeEditorService): void {
  codeEditorService.setTransientModelProperty(model, transientWordWrapState, state);
}

function readTransientState(model: Monaco.editor.ITextModel, codeEditorService: CodeEditorService): IWordWrapTransientState | null {
  return codeEditorService.getTransientModelProperty(model, transientWordWrapState) as IWordWrapTransientState | null;
}

export function installToggleWordWrap(api: typeof Monaco): void {
  const EditorOption = api.editor.EditorOption;
  // Monaco's distribution strips VS Code's transient-property methods. Port
  // that store too, retaining model disposal and change-event semantics.
  const properties = new TransientModelProperties(api);
  const service: CodeEditorService = {
    setTransientModelProperty: (model, key, value) => properties.setTransientModelProperty(model, key, value),
    getTransientModelProperty: (model, key) => properties.getTransientModelProperty(model, key),
    onDidChangeTransientModelProperty: properties.onDidChangeTransientModelProperty,
    listDiffEditors: () => api.editor.getDiffEditors() as DiffEditor[],
  };

  function canToggleWordWrap(service: CodeEditorService, editor: CodeEditor | null): editor is ActiveCodeEditor {
    if (!editor || editor.isSimpleWidget || !editor.getModel()) return false;
    if (editor.getOption(EditorOption.inDiffEditor)) {
      for (const diffEditor of service.listDiffEditors()) {
        if (diffEditor.getOriginalEditor() === editor && !diffEditor._options.renderSideBySide.get()) {
          // The original side of an inline diff is not an active source editor.
          return false;
        }
      }
    }
    return true;
  }

  class ToggleWordWrapAction extends EditorAction {
    constructor() {
      super({
        id: 'editor.action.toggleWordWrap',
        label: 'View: Toggle Word Wrap',
        precondition: undefined,
        kbOpts: {
          kbExpr: null,
          primary: api.KeyMod.Alt | api.KeyCode.KeyZ,
          weight: 100, // KeybindingWeight.EditorContrib, as in VS Code.
        },
      });
    }
    run(_accessor: unknown, editor: CodeEditor): void {
      if (!canToggleWordWrap(service, editor)) return;
      const model = editor.getModel();

      // Read the current state
      const transientState = readTransientState(model, service);
      // Compute the new state
      let newState: IWordWrapTransientState | null;
      if (transientState) {
        newState = null;
      } else {
        const actualWrappingInfo = editor.getOption(EditorOption.wrappingInfo);
        const wordWrapOverride = (actualWrappingInfo.wrappingColumn === -1 ? 'on' : 'off');
        newState = { wordWrapOverride };
      }

      // Write the new state (the controller applies it in every view of this model).
      writeTransientState(model, newState, service);
      const diffEditor = service.listDiffEditors().find(diff =>
        diff.getOriginalEditor() === editor || diff.getModifiedEditor() === editor);
      if (diffEditor) {
        const originalEditor = diffEditor.getOriginalEditor();
        const modifiedEditor = diffEditor.getModifiedEditor();
        const otherEditor = (originalEditor === editor ? modifiedEditor : originalEditor);
        if (canToggleWordWrap(service, otherEditor)) {
          writeTransientState(otherEditor.getModel(), newState, service);
          diffEditor.updateOptions({});
        }
      }
    }
  }
  registerEditorAction(ToggleWordWrapAction);

  function installController(editor: CodeEditor): void {
    let currentlyApplyingEditorConfig = false;
    const ensureWordWrapSettings = () => {
      if (!canToggleWordWrap(service, editor)) return;
      const transientState = readTransientState(editor.getModel(), service);
      try {
        currentlyApplyingEditorConfig = true;
        const wordWrapOverride2 = transientState ? transientState.wordWrapOverride : 'inherit';
        editor.updateOptions({ wordWrapOverride2 });
      } finally {
        currentlyApplyingEditorConfig = false;
      }
    };
    const listeners = [
      editor.onDidChangeConfiguration(event => {
        if (event.hasChanged(EditorOption.wrappingInfo) && !currentlyApplyingEditorConfig) {
          ensureWordWrapSettings();
        }
      }),
      editor.onDidChangeModel(ensureWordWrapSettings),
      service.onDidChangeTransientModelProperty(ensureWordWrapSettings),
    ];
    // Standalone creation hooks replace eager workbench contributions. Apply
    // an already-attached model's state here as well.
    ensureWordWrapSettings();
    editor.onDidDispose(() => listeners.forEach(listener => listener.dispose()));
  }

  function installDiffController(diffEditor: Monaco.editor.IDiffEditor): void {
    const ensureSyncedWordWrapToggle = () => {
      const originalEditor = diffEditor.getOriginalEditor();
      const modifiedEditor = diffEditor.getModifiedEditor();
      const originalModel = originalEditor.getModel();
      const modifiedModel = modifiedEditor.getModel();
      if (!originalModel || !modifiedModel) return;

      const originalTransientState = readTransientState(originalModel, service);
      const modifiedTransientState = readTransientState(modifiedModel, service);
      if (originalTransientState && !modifiedTransientState && canToggleWordWrap(service, originalEditor)) {
        writeTransientState(modifiedModel, originalTransientState, service);
        diffEditor.updateOptions({});
      }
      if (!originalTransientState && modifiedTransientState && canToggleWordWrap(service, modifiedEditor)) {
        writeTransientState(originalModel, modifiedTransientState, service);
        diffEditor.updateOptions({});
      }
    };
    const listener = diffEditor.onDidChangeModel(ensureSyncedWordWrapToggle);
    ensureSyncedWordWrapToggle();
    diffEditor.onDidDispose(() => listener.dispose());
  }

  api.editor.onDidCreateEditor(installController);
  api.editor.onDidCreateDiffEditor(installDiffController);
}
