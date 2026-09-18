import { describe, expect, test } from 'vitest';

import type { DocumentSnapshot } from '../document/document';
import type { ViewportAnchor } from '../preview/viewport-anchor';
import { createTabSession, createWorkspaceTab, WorkspaceState } from './workspace-state';

const anchor: ViewportAnchor = {
  sourceLine: 1,
  yRatio: 0.35,
  reason: 'empty-document',
  confidence: 'fallback',
};

function document(name: string): DocumentSnapshot {
  return {
    path: `/tmp/${name}`,
    name,
    text: '',
    savedText: '',
    revision: 0,
    savedRevision: 0,
    diskVersion: { mtimeMs: 0, size: 0 },
    isUntitled: false,
  };
}

describe('WorkspaceState', () => {
  test('활성 탭을 유일한 session 원본으로 노출한다', () => {
    const workspace = new WorkspaceState();
    const first = createWorkspaceTab('a', document('a.md'), 'viewer', anchor);
    const second = createWorkspaceTab('b', document('b.md'), 'editor', anchor);
    workspace.add(first);
    workspace.add(second);
    workspace.activeId = second.id;
    const session = createTabSession(() => workspace.active, anchor);

    session.revision = 4;
    session.surface = 'viewer';

    expect(first.revision).toBe(0);
    expect(second.revision).toBe(4);
    expect(second.surface).toBe('viewer');
  });

  test('활성 탭 제거 후 인접한 교체 후보를 고른다', () => {
    const workspace = new WorkspaceState();
    for (const id of ['a', 'b', 'c']) {
      workspace.add(createWorkspaceTab(id, document(`${id}.md`), 'viewer', anchor));
    }
    workspace.activeId = 'b';

    const removed = workspace.remove('b');

    expect(removed).toMatchObject({ index: 1, wasActive: true });
    expect(workspace.replacement(removed!.index)?.id).toBe('c');
  });

  test('탭 순환은 양방향으로 끝을 감싼다', () => {
    const workspace = new WorkspaceState();
    workspace.add(createWorkspaceTab('a', document('a.md'), 'viewer', anchor));
    workspace.add(createWorkspaceTab('b', document('b.md'), 'viewer', anchor));
    workspace.activeId = 'a';

    expect(workspace.cycle(-1)?.id).toBe('b');
    expect(workspace.cycle(1)?.id).toBe('b');
  });
});
