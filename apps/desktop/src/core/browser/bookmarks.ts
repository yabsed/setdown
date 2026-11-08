export type BookmarkNode = { id: string; parentId: string; kind: 'folder' | 'bookmark'; title: string; url?: string; order: number; batch?: string };
export type BookmarkListing = { nodes: BookmarkNode[]; trail: Array<{ id: string; title: string }>; total: number };
export type BookmarkImportResult = { batch: string; added: number; skipped: number };
