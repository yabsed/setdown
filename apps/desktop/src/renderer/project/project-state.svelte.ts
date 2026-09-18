import type {
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

const STORAGE_KEY = 'setdown:folder-tools';

function restoredState(): {
  visible: boolean;
  open: boolean;
  activeView: ProjectView;
  folder: ProjectFolder | null;
  expanded: string[];
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
    };
  } catch {
    return { visible: false, open: false, activeView: 'explorer', folder: null, expanded: [] };
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
  searchQuery: '',
  searchResults: [] as ProjectSearchResult[],
  searching: false,
  git: null as GitSnapshot | null,
  gitLoading: false,
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
    }));
  } catch {
    // Session storage can be unavailable in hardened browser environments.
  }
}
