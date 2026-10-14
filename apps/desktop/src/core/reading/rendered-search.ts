/** Search the rendered text, including matches spanning inline elements. */
export function renderedSearchRanges(root: Element, query: string): Range[] {
  if (!query) return [];
  const doc = root.ownerDocument;
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = '';
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return !node.parentElement || node.parentElement.closest(
        'script, style, noscript, annotation, [hidden], .katex-mathml, .MathJax_Preview, mjx-assistive-mml',
      ) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text, start = text.length;
    text += node.data; nodes.push({ node, start, end: text.length });
  }
  const haystack = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase(), ranges: Range[] = [];
  for (let offset = 0; needle && ranges.length < 10_000;) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    const end = found + needle.length;
    const first = nodes.find(entry => entry.start <= found && entry.end > found);
    const last = nodes.find(entry => entry.start < end && entry.end >= end);
    if (first && last) {
      const range = doc.createRange(); range.setStart(first.node, found - first.start); range.setEnd(last.node, end - last.start); ranges.push(range);
    }
    offset = Math.max(end, found + 1);
  }
  return ranges;
}
