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

export const project = $state({
  open: false,
  activeView: 'explorer' as ProjectView,
  folder: null as ProjectFolder | null,
  entries: [] as VisibleProjectEntry[],
  expanded: [] as string[],
  searchQuery: '',
  searchResults: [] as ProjectSearchResult[],
  searching: false,
  git: null as GitSnapshot | null,
  gitLoading: false,
  error: '',
});
