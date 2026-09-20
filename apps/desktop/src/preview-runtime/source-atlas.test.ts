import { afterEach, expect, test, vi } from 'vitest';
import { SourceAtlas } from './source-atlas';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  class Node {
    parentElement: Node | null = null;
    children: Node[] = [];
    constructor(readonly line: number | null, readonly top = 100) {}
    matches(selector: string) { return selector.includes('data-source') && this.line !== null; }
    closest() { return null; }
    getAttribute(name: string) { return name === 'data-source-line' && this.line ? String(this.line) : null; }
    getBoundingClientRect() { return { top:this.top, bottom:this.top+30, left:0, right:200, width:200, height:30 }; }
    querySelectorAll() { return this.children; }
  }
  const root = new Node(null);
  vi.stubGlobal('Element', Node);
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('document', { documentElement:{scrollTop:0,scrollLeft:0,scrollHeight:1000},
    querySelector: (selector: string) => selector.startsWith('.markdown-preview') ? root : null });
  const atlas = new SourceAtlas({lineCount:()=>100,documentIsBlank:()=>false});
  return {Node,root,atlas};
}

test('an authored ancestor resolves a click without querying descendants or the document atlas', () => {
  const {Node,root,atlas} = fixture();
  const paragraph = new Node(12);
  paragraph.querySelectorAll = root.querySelectorAll = () => { throw Error('unnecessary document scan'); };
  expect(atlas.anchorAtPoint(50,110,paragraph as unknown as Element,[paragraph as unknown as Element]))
    .toMatchObject({sourceLine:12,reason:'ancestor-line'});
});

test('an authored descendant resolves a click without scanning unrelated document anchors', () => {
  const {Node,root,atlas} = fixture();
  const target = new Node(null); target.children = [new Node(42)];
  root.querySelectorAll = () => { throw Error('unnecessary document scan'); };
  expect(atlas.anchorAtPoint(50,110,target as unknown as Element,[]))
    .toMatchObject({sourceLine:42,reason:'descendant-line'});
});

test('unannotated whitespace still uses surrounding document anchors', () => {
  const {Node,root,atlas} = fixture();
  root.children = [new Node(10,20), new Node(20,200)];
  const anchor = atlas.anchorAtPoint(50,100,new Node(null) as unknown as Element,[]);
  expect(anchor.reason).toBe('neighbor-interpolation');
  expect(anchor.sourceLine).toBeGreaterThan(10);
  expect(anchor.sourceLine).toBeLessThan(20);
});
