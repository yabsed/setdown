import type {
  GitDiff,
  GitSnapshot,
  ProjectEntry,
  ProjectFolder,
  ProjectSearchResult,
} from '../../protocol/desktop-api';

export type ProjectView = 'explorer' | 'search' | 'git';
export type VisibleProjectEntry = ProjectEntry & {
  depth: number;
  expanded: boolean;
  loading: boolean;
};
export type GitDiffTabState = {
  id: string;
  filePath: string;
  staged: boolean;
  mode: 'rendered' | 'source';
  line: number;
  diff: GitDiff | null;
  loading: boolean;
  previewId: string | null;
  pendingPreviewId: string | null;
  previewLoading: boolean;
  previewDirty: boolean;
};

const STORAGE_KEY = 'setdown:folder-tools';

function restoredState(): {
  visible: boolean;
  open: boolean;
  activeView: ProjectView;
  folder: ProjectFolder | null;
  expanded: string[];
  searchQuery: string;
  expandedSearchGroups: string[];
} {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const activeView = ['explorer', 'search', 'git'].includes(String(value.activeView))
      ? value.activeView as ProjectView : 'explorer';
    return {
      visible: typeof value.visible === 'boolean' ? value.visible : value.open === true,
      open: value.open === true,
      activeView,
      folder: value.folder && typeof value.folder === 'object'
        && typeof (value.folder as ProjectFolder).path === 'string'
        && typeof (value.folder as ProjectFolder).name === 'string'
        ? value.folder as ProjectFolder : null,
      expanded: Array.isArray(value.expanded)
        ? value.expanded.filter((path): path is string => typeof path === 'string') : [],
      searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery : '',
      expandedSearchGroups: Array.isArray(value.expandedSearchGroups)
        ? value.expandedSearchGroups.filter((path): path is string => typeof path === 'string') : [],
    };
  } catch {
    return {
      visible: false,
      open: false,
      activeView: 'explorer',
      folder: null,
      expanded: [],
      searchQuery: '',
      expandedSearchGroups: [],
    };
  }
}

const restored = restoredState();

export const project = $state({
  visible: restored.visible,
  open: restored.open,
  activeView: restored.activeView,
  folder: restored.folder,
  entries: [] as VisibleProjectEntry[],
  expanded: restored.expanded,
  searchQuery: restored.searchQuery,
  searchResults: [] as ProjectSearchResult[],
  expandedSearchGroups: restored.expandedSearchGroups,
  searching: false,
  git: null as GitSnapshot | null,
  gitDiffTabs: [] as GitDiffTabState[],
  activeGitDiffId: null as string | null,
  gitDiff: null as GitDiff | null,
  gitDiffTarget: null as { filePath: string; staged: boolean } | null,
  gitDiffActive: false,
  gitDiffLoading: false,
  gitDiffMode: 'rendered' as 'rendered' | 'source',
  gitDiffPreviewLoading: false,
  gitDiffPreviewReady: false,
  gitDiffFrozen: false,
  gitDiffSnapshot: '',
  gitDiffLine: 1,
  gitLoading: false,
  gitBusy: false,
  commitMessage: '',
  error: '',
});

export function rememberProjectState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      visible: project.visible,
      open: project.open,
      activeView: project.activeView,
      folder: project.folder,
      expanded: project.expanded,
      searchQuery: project.searchQuery,
      expandedSearchGroups: project.expandedSearchGroups,
    }));
  } catch {
    // Session storage can be unavailable in hardened browser environments.
  }
}
