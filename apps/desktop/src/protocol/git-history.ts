import type {
  GitGraphCapabilities, GitGraphCommitDetails, GitGraphComparison,
  GitGraphFileDiff, GitGraphHistoryQuery, GitGraphPage, GitGraphRevision,
} from '@web-git-graph/protocol';

/** Graph DTOs stay at the integration boundary; no Git commands cross IPC. */
export type GitGraphMethods = {
  capabilities: { params: Record<string, never>; result: GitGraphCapabilities };
  history: { params: GitGraphHistoryQuery; result: GitGraphPage };
  details: { params: { revision: GitGraphRevision }; result: GitGraphCommitDetails };
  compare: { params: { base: GitGraphRevision; head: GitGraphRevision }; result: GitGraphComparison };
  diff: { params: { base: GitGraphRevision; head: GitGraphRevision; path: string }; result: GitGraphFileDiff };
};
export type GitGraphRequest = { [M in keyof GitGraphMethods]: {
  id: string; root: string; method: M; params: GitGraphMethods[M]['params'];
} }[keyof GitGraphMethods];
export type GitGraphResult = GitGraphMethods[keyof GitGraphMethods]['result'];

/** Immutable comparison. Omitted base means the selected commit's first parent. */
export type GitHistorySelection = { root: string; head: string; base?: string; path: string };
