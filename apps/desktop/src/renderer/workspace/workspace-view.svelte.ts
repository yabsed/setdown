export type TabView = {
  sessionId?: string;
  kind?: 'document' | 'web' | 'terminal' | 'diff';
  exited?: boolean;
  isUntitled?: boolean;
  page?: import('../../protocol/browser').BrowserPage;
  id: string;
  name: string;
  path: string;
  active: boolean;
  dirty: boolean;
  preview: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type HeadingView = {
  id: string;
  text: string;
  level: number;
};

export type ClosePromptView = {
  scope: 'tab' | 'window';
  names: string[];
};



export const view = $state({
  recoveryCount: 0,
  reloadPrompt: null as { id: string; name: string; revision: number; path: string } | null,
  recoveryError: '',
  groups: [{ id: 'group-0', tabs: [], activeId: null, previewId: null }] as import('../../core/workspace/editor-groups').Group[],
  groupTree: { kind: 'group', id: 'group-0' } as import('../../core/workspace/editor-groups').GroupTree,
  focusedGroupId: 'group-0',
  tabs: [] as TabView[],
  terminalSessions: [] as import('../../core/workspace/workspace-state').TerminalSession[],
  draggedTabId: null as string | null,
  surface: 'empty' as 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video' | 'hwp' | 'notebook' | 'web' | 'terminal' | 'diff',
  hwpTabs: [] as import('../../core/workspace/workspace-state').DocumentTab[],
  notebookTabs: [] as { id: string; path: string; entry: import('../notebook/document-content').NotebookEntry }[],
  mediaTabs: [] as import('./media-cache').MediaTab[],
  activeMediaId: null as string | null,
  documentNotices: {} as Record<string, { message: string; unavailable?: boolean; diskVersion?: import('../../core/document/document').DiskVersion }>,
  noticeMessage: '',
  notice: false,
  unavailablePath: null as string | null,
  tocOpen: false,
  headings: [] as HeadingView[],
  activeHeadingId: null as string | null,
  findOpen: false,
  findQuery: '',
  findActive: 0,
  findMatches: 0,
  rendering: false,
  renderVariant: 'blocking' as 'blocking' | 'refresh',
  renderError: '',
  renderErrorVariant: 'blocking' as 'blocking' | 'refresh',
  closePrompt: null as ClosePromptView | null,
});
