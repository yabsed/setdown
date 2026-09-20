import { afterEach, expect, test, vi } from 'vitest';
import { ReaderController } from './reader-controller';

vi.mock('../view-state.svelte', () => ({ view:{} }));
afterEach(() => vi.unstubAllGlobals());

function fixture(path = '/sample.md') {
  vi.stubGlobal('window', {addEventListener() {}});
  const tab = {id:'doc',document:{path},surface:'editor',revision:1,text:'first\nsecond',
    anchor:{sourceLine:2,yRatio:.5},find:{open:false},previewUrl:'marktex-preview://document/1',previewTheme:'github-light'};
  const commands: unknown[] = [];
  const shown: unknown[] = [];
  const controller = new ReaderController({
    active:()=>tab,activeId:()=>tab.id,tabs:[tab],initialTheme:{id:'github-light',revision:0},
    desktop:{sendPreviewCommand:(_id:string,m:unknown)=>commands.push(m),showPreview:(id:unknown)=>shown.push(id)},
    frames:{getBoundingClientRect:()=>({left:12,top:76,width:800,height:744})},
    anchorChanged() {},
  } as unknown as ConstructorParameters<typeof ReaderController>[0]);
  return {tab,commands,shown,controller};
}

test('source mode primes the reader layout without requesting a visible native view', () => {
  const f=fixture(); f.controller.syncView();
  expect(f.shown).toEqual([null]);
  expect(f.commands).toEqual([{command:'marktex:prime-document',bounds:{x:12,y:76,width:800,height:744}}]);
});

test('plain text and suspended Git ownership do not prepare an ordinary preview', () => {
  const text=fixture('/sample.txt'); text.controller.syncView(); expect(text.commands).toEqual([]);
  const git=fixture(); git.controller.setSuspended(true); git.controller.syncView();
  expect(git.commands).toEqual([]); expect(git.shown).toEqual([]);
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
