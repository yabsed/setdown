import { afterEach, expect, test, vi } from 'vitest';
import { ContentController } from './content-controller';
import type { SourceAtlas } from './source-atlas';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers();
  let layouts=0;
  const root={html:'',className:'',querySelectorAll:()=>[],
    get innerHTML() { return this.html; }, set innerHTML(value:string) { this.html=value; },
    append(content:{html:string}) { this.html+=content.html; },
    getBoundingClientRect() { layouts++; return {}; }};
  vi.stubGlobal('document',{body:{dataset:{}},querySelector:()=>root,
    createElement:()=>({content:{html:'',children:[]},set innerHTML(value:string) {this.content.html=value;}})});
  vi.stubGlobal('window',{setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame() {}});
  const controller=new ContentController({sourceAtlas:{invalidate() {}} as unknown as SourceAtlas,
    applyDisclosures() {},scheduleHeadings() {},viewportChanged() {}});
  const html=Array.from({length:30},(_,i)=>`<p data-block="${i}"><span class="katex">${'x'.repeat(14000)}</span></p>`).join('');
  controller.installSanitized(html);
  return {controller,root,layouts:()=>layouts};
}

test('background preparation yields between bounded batches even without animation frames', () => {
  const f=fixture(); const pending=f.controller.pendingCount;
  f.controller.prepareInBackground(); f.controller.prepareInBackground();
  expect(f.controller.pendingCount).toBe(pending);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersToNextTimer();
  expect(f.controller.pendingCount).toBeGreaterThan(0);
  expect(f.controller.pendingCount).toBeLessThan(pending);
  expect(f.layouts()).toBe(1);
  vi.runAllTimers();
  expect(f.controller.pendingCount).toBe(0);
  expect(f.root.html.match(/data-block=/g)).toHaveLength(30);
});

test('an immediate end-of-document reveal cancels background work without duplicating blocks', () => {
  const f=fixture(); f.controller.prepareInBackground(); vi.advanceTimersToNextTimer();
  f.controller.hydrateAll(); vi.runAllTimers();
  expect(f.controller.pendingCount).toBe(0);
  expect(f.root.html.match(/data-block=/g)).toHaveLength(30);
});

test('replacing a document cancels queued preparation of its old generation', () => {
  const f=fixture(); f.controller.prepareInBackground();
  f.controller.installSanitized('<p>replacement</p>'); vi.runAllTimers();
  expect(f.root.html).toBe('<p>replacement</p>');
  expect(f.controller.pendingCount).toBe(0);
});
