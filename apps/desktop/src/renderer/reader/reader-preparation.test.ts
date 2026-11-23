import { afterEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { ReaderController } from './reader-controller';

vi.mock('../workspace/workspace-view.svelte', () => ({ view:{} }));
afterEach(() => vi.unstubAllGlobals());

function fixture(path = '/sample.md', layout?: {host:string; focused:string}) {
  vi.stubGlobal('window', {addEventListener() {}});
  const tab = {id:'doc',document:{path},surface:'editor',revision:1,text:'first\nsecond',
    anchor:{sourceLine:2,yRatio:.5},find:{open:false},previewUrl:'marktex-preview://document/1',previewTheme:'github-light'};
  const commands: unknown[] = [];
  const shown: unknown[] = [];
  const placed: Array<number|null> = [];
  const links: string[] = [];
  const controller = new ReaderController({
    active:()=>tab,activeId:()=>tab.id,tabs:[tab],initialTheme:{id:'github-light',revision:0},
    desktop:{sendPreviewCommand:(_id:string,m:unknown)=>commands.push(m),
      showPreview:(id:unknown,bounds:{x:number}|null)=>{ shown.push(id); placed.push(bounds?.x ?? null); },
      setBackgroundPreviews() {}, openLink:(href:string)=>links.push(href)},
    // The shell lays the host out for the group named by its `data-focused-group` ancestor.
    frames:{getBoundingClientRect:()=>({left:layout?.host === 'group-1' ? 412 : 12,top:76,width:800,height:744}),
      closest:()=>layout ? {dataset:{focusedGroup:layout.host}} : null},
    focusedGroup:layout ? () => layout.focused : undefined,
    anchorChanged() {},
  } as unknown as ConstructorParameters<typeof ReaderController>[0]);
  return {tab,commands,shown,placed,links,controller};
}

test('source mode primes the reader layout without requesting a visible native view', () => {
  const f=fixture(); f.controller.syncView();
  expect(f.shown).toEqual([null]);
  expect(f.commands).toEqual([{command:'marktex:prime-document',bounds:{x:12,y:76,width:800,height:744}}]);
});

test('plain text and suspended Git ownership do not prepare an ordinary preview', () => {
  const text=fixture('/sample.txt'); text.controller.syncView(); expect(text.commands).toEqual([]);
  const git=fixture(); git.controller.setSuspended(true); git.controller.syncView();
  expect(git.commands).toEqual([]); expect(git.shown.every(id => id === null)).toBe(true);
  expect(git.shown.length).toBeGreaterThan(0);
});

test('background layout cannot overwrite the source editor anchor', () => {
  const f=fixture();
  const payload={tabId:'doc',message:{source:'crossnote',type:'marktex:viewport-state',revision:1,
    anchor:{sourceLine:1,yRatio:.3},scrollRatio:0}};
  f.controller.handleMessage(payload);
  expect(f.tab.anchor.sourceLine).toBe(2);
  f.tab.surface='viewer'; f.controller.handleMessage(payload);
  expect(f.tab.anchor.sourceLine).toBe(1);
});

test('reader link messages remove only the transport encoding and preserve URL escapes', () => {
  const f=fixture();
  for (const href of ['file:///notes/note%23part%2525.md', 'https://example.test/?q=a%26b']) {
    f.controller.handleMessage({tabId:'doc',message:{source:'crossnote',command:'clickTagA',
      args:[{href:encodeURIComponent(href)}]}});
    expect(f.links.at(-1)).toBe(href);
  }
  f.controller.handleMessage({tabId:'doc',message:{source:'crossnote',command:'clickTagA',args:[{href:'%invalid'}]}});
  expect(f.links).toHaveLength(2);
});

test('the focused preview is placed once its host is laid out for the group that received focus', async () => {
  // Focus moved to group-1; the shell still has the host over group-0 until it renders.
  const layout={host:'group-0',focused:'group-1'};
  const f=fixture('/sample.md',layout); f.tab.surface='viewer';
  f.controller.syncView(); f.controller.syncView();
  expect(f.shown).toEqual([]);
  layout.host='group-1'; await tick();
  expect(f.shown).toEqual(['doc']); expect(f.placed).toEqual([412]);
  f.controller.syncView();
  expect(f.placed).toEqual([412,412]);
});

test('a host the shell never moves does not keep the focused preview hidden', async () => {
  const f=fixture('/sample.md',{host:'group-0',focused:'group-1'}); f.tab.surface='viewer';
  f.controller.syncView();
  expect(f.shown).toEqual([]);
  await tick();
  expect(f.shown).toEqual(['doc']);
});

test('source mode is not primed with the rectangle of the group that lost focus', async () => {
  const layout={host:'group-0',focused:'group-1'};
  const f=fixture('/sample.md',layout);
  f.controller.syncView();
  // The other groups' documents are laid out at once; only this host's rectangle is unknown.
  expect(f.shown).toEqual([null]); expect(f.commands).toEqual([]);
  layout.host='group-1'; await tick();
  expect(f.commands).toEqual([{command:'marktex:prime-document',bounds:{x:412,y:76,width:800,height:744}}]);
});
