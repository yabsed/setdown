import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot, PreviewHeading } from '../../shared/contracts';
import type { PreviewThemeId } from '../../shared/preview-preferences';
import type { ViewportAnchor } from '../../shared/viewport-anchor';

export type DocumentTab = {
  id: string;
  document: DocumentSnapshot;
  text: string;
  model: Monaco.editor.ITextModel | null;
  revision: number;
  surface: 'viewer' | 'editor';
  anchor: ViewportAnchor;
  previewUrl: string | null;
  previewRevision: number | null;
  previewTheme: PreviewThemeId | null;
  tocOpen: boolean;
  editorViewState: Monaco.editor.ICodeEditorViewState | null;
  viewerScrollRatio: number | null;
  headings: PreviewHeading[];
  activeHeadingId: string | null;
  find: { open: boolean; query: string; activeMatch: number; matches: number };
};

export function createTabSession(active: () => DocumentTab | null, emptyAnchor: ViewportAnchor) {
  return {
    get document() { return active()?.document ?? null; },
    set document(value: DocumentSnapshot | null) {
      const tab = active();
      if (tab && value) tab.document = value;
    },
    get model() { return active()?.model ?? null; },
    set model(value: Monaco.editor.ITextModel | null) {
      const tab = active();
      if (tab) tab.model = value;
    },
    get revision() { return active()?.revision ?? 0; },
    set revision(value: number) {
      const tab = active();
      if (tab) tab.revision = value;
    },
    get surface(): 'empty' | 'viewer' | 'editor' { return active()?.surface ?? 'empty'; },
    set surface(value: 'empty' | 'viewer' | 'editor') {
      const tab = active();
      if (tab && value !== 'empty') tab.surface = value;
    },
    get anchor() { return active()?.anchor ?? emptyAnchor; },
    set anchor(value: ViewportAnchor) {
      const tab = active();
      if (tab) tab.anchor = value;
    },
  };
}
