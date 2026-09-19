import assert from 'node:assert/strict';
import { test } from 'vitest';
import type * as Monaco from 'monaco-editor';
import { readEditorViewport } from './editor-viewport';
import { reviewViewport } from '../../core/preview/review-viewport';
import { GitDiffViewportPort } from '../project/source-control/git-diff-viewport';

function probe(cursorTop: number, column = 7) {
  const editor = {
    getDomNode: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, height: 800 }) }),
    getTargetAtClientPoint: () => ({ position: { lineNumber: 35 } }),
    getPosition: () => ({ lineNumber: 80, column }),
    getLayoutInfo: () => ({ height: 800, contentLeft: 20 }), getOption: () => 22,
    getTopForPosition: () => cursorTop, getScrollTop: () => 1000,
    getVisibleRanges: () => [{ startLineNumber: 30, endLineNumber: 40 }],
    getTopForLineNumber: (line: number) => 1000 + (line - 30) * 22,
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  return readEditorViewport(editor, { editor: { EditorOption: { lineHeight: 0 } } } as unknown as typeof Monaco,
    { getLineCount: () => 500 } as Monaco.editor.ITextModel, reviewViewport(1).anchor);
}
for (const ratio of [.1, .8]) test(`visible cursor keeps actual screen ratio ${ratio}`, () => {
  const value = probe(1000 + 800 * ratio);
  assert.equal(value.anchor.yRatio, ratio); assert.equal(value.anchor.sourceColumn, 7);
  assert.equal(value.anchor.sourceLine, 80); assert.deepEqual(value.band, []);
});
test('offscreen cursor yields the visible viewport and a band, not the stale cursor line', () => {
  const value = probe(900);
  assert.equal(value.anchor.sourceLine, 35); assert.equal(value.band.length, 11);
  assert.equal(value.band[0].sourceLine, 30);
});
test('wrapped cursor uses its column-specific position, not the logical line top', () => {
  const value = probe(1600, 300);
  assert.equal(value.anchor.sourceColumn, 300); assert.equal(value.anchor.yRatio, .75);
});
test('viewport reader cleanup cannot unregister a newer mounted editor', () => {
  const port = new GitDiffViewportPort();
  const removeOld = port.register(() => reviewViewport(1));
  const removeNew = port.register(() => reviewViewport(2));
  removeOld(); assert.equal(port.read('tab')?.anchor.sourceLine, 2);
  removeNew(); assert.equal(port.read('tab'), null);
});
