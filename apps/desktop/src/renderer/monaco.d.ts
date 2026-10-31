declare module 'monaco-editor/editor/editor.main' {
  export * from 'monaco-editor';
}

// The pinned Monaco context-menu service exposes lifecycle events shared by all
// editor surfaces. Keep the internal dependency limited to this adapter.
declare module 'monaco-editor/editor/standalone/browser/standaloneServices' {
  export const StandaloneServices: {
    get<T>(service: unknown): T;
    withServices(callback: () => import('monaco-editor').IDisposable): import('monaco-editor').IDisposable;
  };
}
declare module 'monaco-editor/platform/contextview/browser/contextView' {
  export const IContextMenuService: unknown;
}

// Register the ported VS Code action with the real contribution registry so it
// participates in keybindings, getAction() and Monaco's command palette.
declare module 'monaco-editor/editor/browser/editorExtensions' {
  export abstract class EditorAction {
    constructor(options: {
      id: string; label: string; precondition?: undefined;
      kbOpts: { kbExpr: null; primary: number; weight: number };
    });
    abstract run(accessor: unknown, editor: import('monaco-editor').editor.ICodeEditor): void;
  }
  export function registerEditorAction(action: new () => EditorAction): EditorAction;
}
