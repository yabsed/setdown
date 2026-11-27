import { expect, it } from 'vitest';
import { MediaCache } from './media-cache';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';

it('does not reuse a remote PDF surface across navigation tokens, even with the same URL and size', () => {
  const cache = new MediaCache();
  const remote = { ...tab('remote'), remote: 'navigation-1' };
  const first = cache.sync([remote], remote.id)[0];
  expect(cache.sync([remote], remote.id)[0]).toBe(first);
  remote.remote = 'navigation-2';
  expect(cache.sync([remote], remote.id)[0]).not.toBe(first);
});

const tab = (id: string) => createWorkspaceTab(id, { kind: 'pdf', path: `/${id}.pdf`, name: id,
  text: '', savedText: '', revision: 0, savedRevision: 0, isUntitled: false,
  diskVersion: { size: 100, mtimeMs: 1 } }, 'pdf', { sourceLine: 1, yRatio: 0, reason: 'empty-document', confidence: 'fallback' });

it('retains visited identities, evicts the least recently used surface, and restores its latest position', () => {
  const tabs = ['a', 'b', 'c', 'd'].map(tab), cache = new MediaCache();
  const first = cache.sync(tabs, 'a')[0];
  cache.sync(tabs, 'b'); cache.sync(tabs, 'c');
  expect(cache.sync(tabs, 'a').at(-1)).toBe(first);
  expect(cache.sync(tabs, null)).toHaveLength(3);
  expect(cache.sync(tabs, 'd').map((entry) => entry.id)).toEqual(['c', 'a', 'd']);
  tabs[1].readingPosition = { kind: 'pdf', page: 8, left: 0, top: 5, zoom: 1.5, rotation: 90 };
  expect(cache.sync(tabs, 'b').at(-1)?.position).toEqual(tabs[1].readingPosition);
});

it('invalidates closed, replaced and renamed surfaces without mounting unvisited background tabs', () => {
  const tabs = ['a', 'b'].map(tab), cache = new MediaCache();
  expect(cache.sync(tabs, null)).toEqual([]);
  const first = cache.sync(tabs, 'a')[0];
  tabs[0].document = { ...tabs[0].document, diskVersion: { size: 200, mtimeMs: 2 } };
  expect(cache.sync(tabs, 'a')[0].key).not.toBe(first.key);
  tabs[0].document.path = '/renamed.pdf';
  expect(cache.sync(tabs, null)).toEqual([]);
  cache.sync(tabs, 'b');
  expect(cache.sync([tabs[0]], null)).toEqual([]);
});

it('pins every visible group even beyond cache capacity and evicts hidden readers first', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e'].map(tab), cache = new MediaCache();
  const pinned = ['a', 'b', 'c', 'd'];
  expect(cache.sync(tabs, 'd', pinned).map(entry => entry.id)).toEqual(pinned);
  expect(cache.sync(tabs, 'e', ['a', 'b', 'e']).map(entry => entry.id)).toEqual(['a', 'b', 'e']);
});


it('releases hidden media under pressure and restores a cold PDF at its latest position', () => {
  const tabs = ['a', 'b', 'c'].map(tab), cache = new MediaCache();
  cache.sync(tabs, 'a'); cache.sync(tabs, 'b');
  const visible = cache.sync(tabs, 'c', ['a', 'c']);
  cache.setPressure(true);
  expect(cache.sync(tabs, 'c', ['a', 'c'])).toEqual(visible.filter(entry => entry.id !== 'b'));
  tabs[1].readingPosition = { kind: 'pdf', page: 7, left: 0, top: 9, zoom: 2, rotation: 0 };
  expect(cache.sync(tabs, 'b')[0].position).toEqual(tabs[1].readingPosition);
  expect(cache.sync(tabs, 'b')).toHaveLength(1);
  cache.setPressure(false); expect(cache.sync(tabs, 'a')).toHaveLength(2);
});


it('pressure keeps a cached local video while releasing a hidden PDF', () => {
  const video = tab('video'); video.document = { ...video.document, kind: 'video', path: '/clip.webm' };
  const pdf = tab('pdf'), image = tab('image'), cache = new MediaCache();
  image.document = { ...image.document, kind: 'image', path: '/image.png' };
  const inputs = [video, pdf, image];
  const retained = cache.sync(inputs, video.id)[0];
  cache.sync(inputs, pdf.id); cache.sync(inputs, image.id);
  cache.setPressure(true);
  expect(cache.sync(inputs, image.id)).toEqual([retained, expect.objectContaining({ id: image.id })]);
});

it('keeps an editable Word surface across its own saves, while read-only Office surfaces follow the disk version', () => {
  const office = (id: string, file: string) => createWorkspaceTab(id, { kind: 'office', ...(file.endsWith('.docx') ? { officeEditor: 'word' as const } : {}), path: file, name: file.slice(1),
    text: '', savedText: '', revision: 0, savedRevision: 0, isUntitled: false,
    diskVersion: { size: 100, mtimeMs: 1 } }, 'office', { sourceLine: 1, yRatio: 0, reason: 'empty-document', confidence: 'fallback' });
  const tabs = [office('word', '/report.docx'), office('legacy', '/report.doc')], cache = new MediaCache();
  cache.sync(tabs, 'legacy');
  const [legacy, word] = cache.sync(tabs, 'word');
  // The Word editor's session outlives a save; remounting its surface would drop the caret on every Ctrl+S.
  for (const tab of tabs) tab.document = { ...tab.document, diskVersion: { size: 200, mtimeMs: 2 } };
  const saved = cache.sync(tabs, 'word');
  expect(saved.find(entry => entry.id === 'word')).toBe(word);
  expect(saved.find(entry => entry.id === 'legacy')).toBeUndefined();
  expect(cache.sync(tabs, 'legacy').find(entry => entry.id === 'legacy')).not.toBe(legacy);
  // Save As still gives the renamed document a surface of its own.
  tabs[0].document = { ...tabs[0].document, path: '/copy.docx' };
  const renamed = cache.sync(tabs, 'word').find(entry => entry.id === 'word');
  expect(renamed).not.toBe(word);
  // A file that stops being a Word package (or becomes one) changes hands between the editor and the viewer.
  tabs[0].document = { ...tabs[0].document, officeEditor: undefined };
  expect(cache.sync(tabs, 'word').find(entry => entry.id === 'word')).not.toBe(renamed);
});
