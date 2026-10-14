import { renderedSearchRanges } from '../../core/reading/rendered-search';

/** One finder per visible reader; no searches are sent to its hidden web page. */
export function createRenderedFind(root: HTMLElement, content: HTMLElement, id: string, changed: (active: number, matches: number) => void) {
  const all = `reader-${id}-matches`, active = `reader-${id}-active`;
  let query = '', ranges: Range[] = [], index = -1;
  const style = document.createElement('style');
  style.textContent = `::highlight(${all}){background:rgba(255,210,64,.58);color:inherit}::highlight(${active}){background:#ff9f1c;color:#17130b}`;
  document.head.append(style);
  const clear = () => { CSS.highlights.delete(all); CSS.highlights.delete(active); };
  return {
    search(text: string, forward = true, next = false) {
      if (text !== query || !next) { query = text; ranges = renderedSearchRanges(content, text); index = ranges.length ? forward ? 0 : ranges.length - 1 : -1; }
      else if (ranges.length) index = (index + (forward ? 1 : -1) + ranges.length) % ranges.length;
      clear();
      if (ranges.length) {
        CSS.highlights.set(all, new Highlight(...ranges)); CSS.highlights.set(active, new Highlight(ranges[index]));
        const rect = ranges[index].getBoundingClientRect(), viewport = root.getBoundingClientRect();
        if (rect.top < viewport.top + 48 || rect.bottom > viewport.bottom - 24) root.scrollTop += rect.top - viewport.top - root.clientHeight / 2;
      }
      changed(index + 1, ranges.length);
    },
    dispose() { clear(); style.remove(); },
  };
}
