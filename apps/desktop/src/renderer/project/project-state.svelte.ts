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

function restoredState(): { open: boolean; activeView: ProjectView; expanded: string[] } {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    const activeView = ['explorer', 'search', 'git'].includes(String(value.activeView))
      ? value.activeView as ProjectView : 'explorer';
    return {
      open: value.open === true,
      activeView,
      expanded: Array.isArray(value.expanded)
        ? value.expanded.filter((path): path is string => typeof path === 'string') : [],
    };
  } catch {
    return { open: false, activeView: 'explorer', expanded: [] };
  }
}

const restored = restoredState();

export const project = $state({
  open: restored.open,
  activeView: restored.activeView,
  folder: null as ProjectFolder | null,
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
      open: project.open,
      activeView: project.activeView,
      expanded: project.expanded,
    }));
  } catch {
    // Session storage can be unavailable in hardened browser environments.
  }
}
