import { literalSearch } from './search-text';

/** Search the rendered text, including matches spanning inline elements. */
export function renderedSearchRanges(root: Element, query: string): Range[] {
  if (!query) return [];
  const doc = root.ownerDocument;
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = '';
  const styles = new Map<Element, CSSStyleDeclaration | undefined>();
  const displayed = new Map<Element, boolean>();
  const style = (element: Element) => {
    if (!styles.has(element)) styles.set(element, doc.defaultView?.getComputedStyle(element));
    return styles.get(element);
  };
  const isDisplayed = (element: Element): boolean => {
    if (!displayed.has(element)) displayed.set(element,
      style(element)?.display !== 'none' && style(element)?.contentVisibility !== 'hidden'
      && (!element.parentElement || isDisplayed(element.parentElement)));
    return displayed.get(element)!;
  };
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return !parent || parent.closest(
        'script, style, noscript, annotation, [hidden], .katex-mathml, .MathJax_Preview, mjx-assistive-mml',
      ) || !isDisplayed(parent) || ['hidden', 'collapse'].includes(style(parent)?.visibility ?? '')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text, start = text.length;
    text += node.data; nodes.push({ node, start, end: text.length });
  }
  const ranges: Range[] = [];
  for (const { start: found, end } of literalSearch(text, query)) {
    if (ranges.length >= 10_000) break;
    const first = nodes.find(entry => entry.start <= found && entry.end > found);
    const last = nodes.find(entry => entry.start < end && entry.end >= end);
    if (first && last) {
      const range = doc.createRange(); range.setStart(first.node, found - first.start); range.setEnd(last.node, end - last.start); ranges.push(range);
    }
  }
  return ranges;
}
