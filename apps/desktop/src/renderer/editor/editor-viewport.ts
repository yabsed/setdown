import type * as Monaco from 'monaco-editor';
import {
  GOLDEN_TOP_RATIO,
  clamp,
  resolveEditorViewport,
  type BandLine,
  type EditorCursorProbe,
  type ViewportAnchor,
} from '../../shared/viewport-anchor';

function visibleCursor(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
): EditorCursorProbe | null {
  const position = editor.getPosition();
  if (!position) return null;
  const height = editor.getLayoutInfo().height;
  if (height <= 0) return null;
  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
  const offset = editor.getTopForPosition(position.lineNumber, position.column)
    - editor.getScrollTop();
  return offset < 0 || offset + lineHeight > height ? null : {
    line: position.lineNumber,
    column: position.column,
    yRatio: offset / height,
  };
}

function visibleBand(
  editor: Monaco.editor.IStandaloneCodeEditor,
): BandLine[] {
  const height = editor.getLayoutInfo().height;
  if (height <= 0) return [];
  const scrollTop = editor.getScrollTop();
  return editor.getVisibleRanges().flatMap((range) =>
    Array.from({ length: range.endLineNumber - range.startLineNumber + 1 }, (_, offset) => {
      const sourceLine = range.startLineNumber + offset;
      return {
        sourceLine,
        yRatio: clamp((editor.getTopForLineNumber(sourceLine) - scrollTop) / height, 0, 1),
      };
    }));
}

export function readEditorViewport(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  monaco: typeof Monaco | null,
  model: Monaco.editor.ITextModel | null,
  fallback: ViewportAnchor,
): { anchor: ViewportAnchor; band: BandLine[] } {
  if (!editor || !monaco || !model) return { anchor: fallback, band: [] };
  const node = editor.getDomNode();
  let probedLine: number | null = null;
  if (node) {
    const rect = node.getBoundingClientRect();
    probedLine = editor.getTargetAtClientPoint(
      rect.left + editor.getLayoutInfo().contentLeft + 8,
      rect.top + rect.height * GOLDEN_TOP_RATIO,
    )?.position?.lineNumber ?? null;
  }
  const cursor = visibleCursor(editor, monaco);
  return {
    anchor: resolveEditorViewport({
      probedLine,
      firstVisibleLine: editor.getVisibleRanges()[0]?.startLineNumber ?? null,
      lineCount: model.getLineCount(),
      yRatio: GOLDEN_TOP_RATIO,
      cursor,
    }),
    band: cursor ? [] : visibleBand(editor),
  };
}
