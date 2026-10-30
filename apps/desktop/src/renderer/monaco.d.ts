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
