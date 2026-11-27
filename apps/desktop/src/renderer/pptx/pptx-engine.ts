/**
 * What the presentation surface and its sessions need from an editing engine.
 * `pptx-runtime.ts` implements it; nothing else imports the engine.
 */
import type { EditEngine, EditMode } from '../office-edit/edit-sessions';

export type PptxMode = EditMode;
export type PptxControlState = { enabled: boolean; active: boolean; value?: string | number };
/** A slide of the deck in order. `key` stays with the slide when others are added, removed or moved. */
export type PptxSlide = { key: string; hidden: boolean };
/** `slide` is where the current match is, or -1 without one. */
export type PptxFind = { count: number; index: number; slide: number };
export type PptxView = {
  ready: boolean; error: string | null; mode: PptxMode;
  /** The slide on the stage, from 0. */
  slide: number; slides: readonly PptxSlide[];
  /** Width of a slide over its height. */
  aspect: number;
  canUndo: boolean; canRedo: boolean;
  /** What is selected on the stage: nothing, shapes, or text inside one. */
  selection: 'none' | 'shapes' | 'text';
  fontSize: number | null; align: string | null;
  /** A slide could not be read: the deck can be looked at, and saving is refused. */
  damaged: boolean;
};

/** What can be added to the slide on the stage. A picture comes with its bytes, its type and its size in pixels. */
export type PptxInsert = { kind: 'textBox' } | { kind: 'shape'; preset: string } | { kind: 'line'; line: 'line' | 'arrow' }
  | { kind: 'table'; rows: number; columns: number } | { kind: 'picture'; bytes: Uint8Array; mime: string; width: number; height: number };

export interface PptxEngine extends EditEngine {
  /** A surface shows this deck; `host` holds the stage (the slide being edited) while the mode is `edit`. */
  mount(host: HTMLElement): void;
  unmount(host?: HTMLElement): void;
  view(): PptxView;
  /** Called after anything `view()` reports may have changed. */
  subscribe(listener: () => void): () => void;
  setMode(mode: PptxMode): void;
  control(id: PptxControlId): PptxControlState;
  run(id: PptxControlId, value?: string | number): boolean;
  /** SVG path data of a control's icon (Material Symbols, 960-unit box); `value` picks an option of a choice control. */
  icon(id: PptxControlId, value?: string): readonly string[];
  goToSlide(index: number): void;
  /** Adds a slide after the current one, copies the current one, or removes it. */
  slide(action: 'add' | 'duplicate' | 'delete'): boolean;
  /** Adds a text box (with the caret in it), a shape, a line, a table or a picture to the slide on the stage, selected. */
  insert(what: PptxInsert): boolean;
  /**
   * Paints slide `index` into `box`, or brings the picture in it up to date: the engine repaints a box only when it is
   * asked again, so a surface asks for every box whenever the deck changed. A box out of sight is painted when it comes
   * into view or the browser is idle. Returns a function that forgets the box.
   */
  paint(index: number, box: HTMLElement): () => void;
  /**
   * The link under a point of a slide, given as fractions of its width and height: an address that is safe to open,
   * `#slide-3` and the like for a slide of the deck, or null.
   */
  linkAt(index: number, x: number, y: number): string | null;
  find(query: string): PptxFind;
  findStep(direction: 1 | -1): PptxFind;
  clearFind(): void;
  focus(): void;
  /**
   * Presses the slide on the stage at a point given as fractions of its width and height, once the stage is laid out,
   * and takes the keyboard: the caret lands in the text there, a shape without text is selected, an empty place selects nothing.
   */
  press(x: number, y: number): Promise<void>;
}

export const PPTX_HISTORY = [{ id: 'history.undo', label: 'Undo' }, { id: 'history.redo', label: 'Redo' }] as const;
export const PPTX_TOGGLES = [
  { id: 'text.bold', label: 'Bold' }, { id: 'text.italic', label: 'Italic' },
  { id: 'text.underline', label: 'Underline' }, { id: 'text.strike', label: 'Strikethrough' },
] as const;
/** One control in the engine, `paragraph.align`, with these values. */
export const PPTX_ALIGNMENTS = [
  { value: 'l', label: 'Align left' }, { value: 'ctr', label: 'Center' }, { value: 'r', label: 'Align right' }, { value: 'just', label: 'Justify' },
] as const;
export const PPTX_LISTS = [
  { id: 'list.bullet', label: 'Bulleted list' }, { id: 'list.numbered', label: 'Numbered list' },
  { id: 'list.outdent', label: 'Decrease indent' }, { id: 'list.indent', label: 'Increase indent' },
] as const;
export type PptxControlId = (typeof PPTX_HISTORY | typeof PPTX_TOGGLES | typeof PPTX_LISTS)[number]['id'] | 'font.size' | 'paragraph.align';
export const PPTX_CONTROL_IDS: readonly PptxControlId[] = [...PPTX_HISTORY, ...PPTX_TOGGLES, ...PPTX_LISTS].map(item => item.id).concat(['font.size', 'paragraph.align'] as never[]);
/** The shapes offered for insertion: DrawingML preset names, and the two straight lines. */
export const PPTX_SHAPES: readonly { id: string; label: string; insert: PptxInsert }[] = [
  { id: 'rect', label: 'Rectangle', insert: { kind: 'shape', preset: 'rect' } },
  { id: 'roundRect', label: 'Rounded rectangle', insert: { kind: 'shape', preset: 'roundRect' } },
  { id: 'ellipse', label: 'Ellipse', insert: { kind: 'shape', preset: 'ellipse' } },
  { id: 'triangle', label: 'Triangle', insert: { kind: 'shape', preset: 'triangle' } },
  { id: 'rightArrow', label: 'Block arrow', insert: { kind: 'shape', preset: 'rightArrow' } },
  { id: 'line', label: 'Line', insert: { kind: 'line', line: 'line' } },
  { id: 'arrow', label: 'Arrow', insert: { kind: 'line', line: 'arrow' } },
];
/** The picture files the engine stores in a slide as they are. */
export const PPTX_PICTURE_TYPES = 'image/png,image/jpeg,image/gif';
export const PPTX_FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96] as const;
