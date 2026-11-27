/**
 * The vocabulary between the workspace and the DOCX engine. Nothing here imports
 * the engine, so sessions, the toolbar and their tests never load it.
 */
export type DocxMode = 'view' | 'edit';
export type DocxControlState = { enabled: boolean; active: boolean; value?: string };
export type DocxStyle = { id: string; name: string };
/** `index` is the zero-based active match, or -1 while nothing is selected. */
export type DocxFind = { count: number; index: number };
/** A clicked link and the viewport rectangle of the clicked line. */
export type DocxLink = { href: string; left: number; top: number; bottom: number };
export type DocxView = {
  /** The document is parsed and its first pages are painted in its own fonts. */
  ready: boolean;
  error: string | null;
  mode: DocxMode;
  page: number; pages: number;
  canUndo: boolean; canRedo: boolean;
  /** Point size and paragraph style at the selection; null when mixed or unknown. */
  fontSize: number | null;
  styleId: string | null;
};

export interface DocxEngine {
  /** Builds the scrollable page viewport inside `host` and paints into it. Returns the scroller. */
  mount(host: HTMLElement, options?: { focus?: boolean }): HTMLElement;
  /** Leaves `host` and keeps the document, undo history and selection for a later mount.
   * A host the engine has already left for another one is ignored. */
  unmount(host?: HTMLElement): void;
  /** Whether some surface currently shows this document. */
  mounted(): boolean;
  destroy(): void;
  view(): DocxView;
  /** Selection, formatting, page or mode changed. Coalesced to one call per frame. */
  subscribe(listener: () => void): () => void;
  /** A user edit was committed. Loading and font re-pagination never report here. */
  onEdit(listener: () => void): () => void;
  /** A click on a link whose target is a sanitized absolute URL. */
  onLink(listener: (link: DocxLink) => void): () => void;
  setMode(mode: DocxMode): void;
  setAppearance(appearance: 'light' | 'dark'): void;
  control(id: DocxControlId): DocxControlState;
  run(id: DocxControlId, value?: string | number): boolean;
  icon(id: DocxControlId): readonly string[];
  styles(): readonly DocxStyle[];
  insertTable(rows: number, columns: number): boolean;
  /** Commits pending input and captures the document as it is at the call; later edits belong to the next save. */
  serialize(): Promise<Uint8Array>;
  find(query: string): DocxFind;
  findStep(direction: 1 | -1): DocxFind;
  clearFind(): void;
  /** The scale the engine currently paints at; 1 is 100%. */
  scale(): number;
  /** Fit the page width (between 50% and 100%), or hold `scale`. */
  setScale(scale: number | 'fit'): void;
  focus(): void;
}

/** Toolbar controls, named by the engine's public slot ids. */
export const DOCX_TOGGLES = [
  { id: 'text.bold', label: 'Bold (Ctrl+B)' },
  { id: 'text.italic', label: 'Italic (Ctrl+I)' },
  { id: 'text.underline', label: 'Underline (Ctrl+U)' },
  { id: 'text.strike', label: 'Strikethrough' },
] as const;
export const DOCX_SCRIPTS = [
  { id: 'script.super', label: 'Superscript' },
  { id: 'script.sub', label: 'Subscript' },
] as const;
export const DOCX_ALIGNMENTS = [
  { id: 'alignment.left', label: 'Align left' },
  { id: 'alignment.center', label: 'Center' },
  { id: 'alignment.right', label: 'Align right' },
  { id: 'alignment.justify', label: 'Justify' },
] as const;
export const DOCX_LISTS = [
  { id: 'list.bullet', label: 'Bulleted list' },
  { id: 'list.numbered', label: 'Numbered list' },
  { id: 'list.outdent', label: 'Decrease indent' },
  { id: 'list.indent', label: 'Increase indent' },
] as const;
export const DOCX_HISTORY = [
  { id: 'history.undo', label: 'Undo (Ctrl+Z)' },
  { id: 'history.redo', label: 'Redo (Ctrl+Y)' },
] as const;
export const DOCX_EXTRAS = [
  { id: 'format.clear', label: 'Clear formatting' },
  { id: 'insert.pageBreak', label: 'Insert page break' },
] as const;
export type DocxControlId = (typeof DOCX_TOGGLES | typeof DOCX_SCRIPTS | typeof DOCX_ALIGNMENTS | typeof DOCX_LISTS
  | typeof DOCX_HISTORY | typeof DOCX_EXTRAS)[number]['id'] | 'styles.style' | 'font.size' | 'table.insert';
/** Every control the toolbar shows. Their states are read together, outside any reactive computation. */
export const DOCX_CONTROL_IDS: readonly DocxControlId[] = [...DOCX_HISTORY, ...DOCX_TOGGLES, ...DOCX_SCRIPTS, ...DOCX_ALIGNMENTS, ...DOCX_LISTS, ...DOCX_EXTRAS]
  .map(item => item.id as DocxControlId).concat(['styles.style', 'font.size', 'table.insert']);
/** Word's own size list, in points. */
export const DOCX_FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;
