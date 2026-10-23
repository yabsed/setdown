import { afterEach, expect, test, vi } from 'vitest';
import { ReaderController } from './reader-controller';

vi.mock('../workspace/workspace-view.svelte', () => ({ view:{} }));
afterEach(() => vi.unstubAllGlobals());

function fixture(path = '/sample.md') {
  vi.stubGlobal('window', {addEventListener() {}});
  const tab = {id:'doc',document:{path},surface:'editor',revision:1,text:'first\nsecond',
    anchor:{sourceLine:2,yRatio:.5},find:{open:false},previewUrl:'marktex-preview://document/1',previewTheme:'github-light'};
  const commands: unknown[] = [];
  const shown: unknown[] = [];
  const links: string[] = [];
  const controller = new ReaderController({
    active:()=>tab,activeId:()=>tab.id,tabs:[tab],initialTheme:{id:'github-light',revision:0},
    desktop:{sendPreviewCommand:(_id:string,m:unknown)=>commands.push(m),showPreview:(id:unknown)=>shown.push(id),
      setBackgroundPreviews() {}, openLink:(href:string)=>links.push(href)},
    frames:{getBoundingClientRect:()=>({left:12,top:76,width:800,height:744})},
    anchorChanged() {},
  } as unknown as ConstructorParameters<typeof ReaderController>[0]);
  return {tab,commands,shown,links,controller};
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
