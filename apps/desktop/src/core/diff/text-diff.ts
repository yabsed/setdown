import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  cleanupSemantic,
  makeDiff,
} from '@sanity/diff-match-patch';
import type { GitDiffHunk } from '../../protocol/desktop-api';

const lineBreaks = (text: string) => text.match(/\n/g)?.length ?? 0;

/** Uses the diff engine to map an in-memory editor buffer to rendered source-line hunks. */
export function textDiffHunks(original: string, modified: string): GitDiffHunk[] {
  if (original === modified) return [];
  const hunks: GitDiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
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
      oldLine += breaks;
      newLine += breaks;
    } else if (operation === DIFF_DELETE) {
      const hunk = begin();
      hunk.oldTouched = true;
      hunk.oldEnd = Math.max(hunk.oldEnd, touchedEnd(oldLine, text));
      oldLine += breaks;
    } else if (operation === DIFF_INSERT) {
      const hunk = begin();
      hunk.newTouched = true;
      hunk.newEnd = Math.max(hunk.newEnd, touchedEnd(newLine, text));
      newLine += breaks;
    }
  }
  flush();
  return hunks;
}
