import { mathIslands, replaceMathIslands } from '../core/preview/math-islands';

const MARKER = 'data-setdown-math-reuse';
function sideOf(node: Element): string {
  const cell = node.closest('.setdown-diff-cell');
  if (cell?.classList.contains('setdown-rendered-diff-before')) return 'before';
  if (cell?.classList.contains('setdown-rendered-diff-after')) return 'after';
  return cell?.getAttribute('data-change') === 'removed' ? 'before' : 'after';
}

/** Prepare detached shells, then move exact existing math only at commit time.
 * Each occurrence is distinct; never steal nodes from retained rows/other sides.
 * A serialization mismatch simply takes the ordinary HTML parsing path.
 */
export function prepareReviewMathRow(html: string, previous: Element[], used = new Set<Element>()) {
  const holder = document.createElement('template');
  const islands = html.includes(MARKER) ? null : mathIslands(html);
  const pools = new Map<string, Map<string, Element[]>>();
  if (islands?.length && previous.length) {
    const wanted = new Set(islands.map((island) => island.html));
    for (const row of previous) {
      for (const node of row.querySelectorAll('span.katex')) {
        if (used.has(node) || node.parentElement?.closest('span.katex')) continue;
        const exact = node.outerHTML;
        if (!wanted.has(exact)) continue;
        const sides = pools.get(exact) ?? new Map<string, Element[]>();
        const side = sideOf(node);
        const nodes = sides.get(side) ?? [];
        nodes.push(node); sides.set(side, nodes); pools.set(exact, sides);
      }
    }
  }
  if (!islands?.length || !pools.size) {
    holder.innerHTML = html;
    return { holder, reusedMath: 0, commit() {} };
  }
  holder.innerHTML = replaceMathIslands(html, islands, (island, index) => pools.has(island.html)
    ? `<template ${MARKER}="${index}"></template>` : island.html);
  const moves: Array<{ placeholder: Element; node: Element }> = [];
  for (const placeholder of holder.content.querySelectorAll(`template[${MARKER}]`)) {
    const island = islands[Number(placeholder.getAttribute(MARKER))];
    const node = pools.get(island.html)?.get(sideOf(placeholder))?.shift();
    if (node) { used.add(node); moves.push({ placeholder, node }); }
    else {
      // Same formula in another pane is not the same DOM occurrence.
      const fresh = document.createElement('template'); fresh.innerHTML = island.html;
      placeholder.replaceWith(fresh.content);
    }
  }
  return { holder, reusedMath: moves.length,
    commit() { for (const { placeholder, node } of moves) placeholder.replaceWith(node); } };
}
