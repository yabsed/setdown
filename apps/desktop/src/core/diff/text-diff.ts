import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  cleanupSemantic,
  makeDiff,
} from '@sanity/diff-match-patch';

/** Changed line range. Mirrors the transferable hunk shape without importing IPC layers. */
export type TextDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

const lineBreaks = (text: string) => text.match(/\n/g)?.length ?? 0;

/** Uses the diff engine to map an in-memory editor buffer to rendered source-line hunks. */
export function textDiffHunks(original: string, modified: string): TextDiffHunk[] {
  if (original === modified) return [];
  const hunks: TextDiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let oldColumn = 0;
  let newColumn = 0;
  let oldOffset = 0;
  let newOffset = 0;
  let active: {
    oldStart: number;
    newStart: number;
    oldEnd: number;
    newEnd: number;
    oldTouched: boolean;
    newTouched: boolean;
  } | null = null;

  const begin = () => active ??= {
    oldStart: oldLine,
    newStart: newLine,
    oldEnd: oldLine,
    newEnd: newLine,
    oldTouched: false,
    newTouched: false,
  };
  const touchedEnd = (line: number, text: string) => line + Math.max(
    0,
    lineBreaks(text) - (text.endsWith('\n') ? 1 : 0),
  );
  const advance = (side: 'old' | 'new', text: string) => {
    const breaks = lineBreaks(text);
    const lastBreak = text.lastIndexOf('\n');
    if (side === 'old') {
      oldLine += breaks;
      oldColumn = lastBreak < 0 ? oldColumn + text.length : text.length - lastBreak - 1;
      oldOffset += text.length;
    } else {
      newLine += breaks;
      newColumn = lastBreak < 0 ? newColumn + text.length : text.length - lastBreak - 1;
      newOffset += text.length;
    }
  };
  const flush = () => {
    if (!active) return;
    hunks.push({
      oldStart: active.oldStart,
      oldLines: active.oldTouched ? active.oldEnd - active.oldStart + 1 : 0,
      newStart: active.newStart,
      newLines: active.newTouched ? active.newEnd - active.newStart + 1 : 0,
    });
    active = null;
  };

  const changes = cleanupSemantic(makeDiff(original, modified, { checkLines: true }));
  for (const [operation, text] of changes) {
    const breaks = lineBreaks(text);
    if (operation === DIFF_EQUAL) {
      if (breaks) flush();
      advance('old', text);
      advance('new', text);
    } else if (operation === DIFF_DELETE) {
      const hunk = begin();
      hunk.oldTouched = true;
      hunk.oldEnd = Math.max(hunk.oldEnd, touchedEnd(oldLine, text));
      const removesWholeLines = newColumn === 0
        && (text.endsWith('\n') || newOffset === modified.length);
      if (!removesWholeLines) {
        hunk.newTouched = true;
        hunk.newEnd = Math.max(hunk.newEnd, newLine);
      }
      advance('old', text);
    } else if (operation === DIFF_INSERT) {
      const hunk = begin();
      hunk.newTouched = true;
      hunk.newEnd = Math.max(hunk.newEnd, touchedEnd(newLine, text));
      const insertsWholeLines = oldColumn === 0
        && (text.endsWith('\n') || oldOffset === original.length);
      if (!insertsWholeLines) {
        hunk.oldTouched = true;
        hunk.oldEnd = Math.max(hunk.oldEnd, oldLine);
      }
      advance('new', text);
    }
  }
  flush();
  return hunks;
}
