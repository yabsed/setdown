import { describe, expect, test } from 'vitest';
import {
  comparisonTitle,
  resolveUnstagedComparison,
  stagedComparisonTitle,
} from './four-stage';

describe('four-stage comparison', () => {
  test('uses the saved working tree when no buffer is open', () => {
    expect(resolveUnstagedComparison({
      indexText: 'a\n',
      diskText: 'b\n',
      bufferText: null,
    })).toMatchObject({
      originalLabel: 'INDEX',
      modifiedLabel: 'WORKTREE',
      modifiedText: 'b\n',
      includesUnsaved: false,
    });
  });

  test('uses the saved working tree when the buffer matches the disk', () => {
    expect(resolveUnstagedComparison({
      indexText: 'a\n',
      diskText: 'b\n',
      bufferText: 'b\n',
    })).toMatchObject({ modifiedLabel: 'WORKTREE', includesUnsaved: false });
  });

  test('shows the editor buffer once it differs from the saved file', () => {
    const resolved = resolveUnstagedComparison({
      indexText: 'int x = 2;\n',
      diskText: 'int x = 3;\n',
      bufferText: 'int x = 4;\n',
    });
    expect(resolved).toMatchObject({
      originalText: 'int x = 2;\n',
      modifiedText: 'int x = 4;\n',
      originalLabel: 'INDEX',
      modifiedLabel: 'BUFFER',
      includesUnsaved: true,
    });
    expect(comparisonTitle(resolved)).toContain('BUFFER');
  });

  test('keeps untracked files on the empty-to-content axis', () => {
    expect(resolveUnstagedComparison({
      indexText: '',
      diskText: 'new\n',
      bufferText: 'new edited\n',
      untracked: true,
    })).toMatchObject({
      originalLabel: 'EMPTY',
      modifiedLabel: 'BUFFER',
      includesUnsaved: true,
    });
  });

  test('passes binary sides through without claiming unsaved content', () => {
    expect(resolveUnstagedComparison({
      indexText: 'a\n',
      diskText: null,
      bufferText: 'b\n',
    })).toMatchObject({ modifiedText: null, includesUnsaved: false });
  });

  test('staged reviews always compare HEAD with the index', () => {
    expect(stagedComparisonTitle()).toBe('HEAD ↔ INDEX');
  });
});
