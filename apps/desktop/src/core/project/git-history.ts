/** Immutable Git comparison identity, independent of transport. */
export type GitHistorySelection = { root: string; head: string; base?: string; path: string };
