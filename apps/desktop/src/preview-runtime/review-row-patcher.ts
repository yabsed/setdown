import { REVIEW_SOURCE_ATTRIBUTES, shiftedReviewAttribute,
  type ReviewRowsPatch, type ReviewTreePatch } from '../core/preview/review-row-patch';

import { prepareReviewMathRow } from './review-math-dom';

const SOURCE_SELECTOR = REVIEW_SOURCE_ATTRIBUTES.map((name) => `[${name}]`).join(',');
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
function shiftCell(cell: Element, delta: number): void {
  if (!delta) return;
  for (const element of [cell, ...cell.querySelectorAll(SOURCE_SELECTOR)]) {
    for (const name of REVIEW_SOURCE_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null) {
        const next = shiftedReviewAttribute(name, value, delta);
        if (next !== value) element.setAttribute(name, next);
      }
    }
  }
}
/** Validate and parse both representations before touching either live tree. */
function prepareTree(root: Element, patch: ReviewTreePatch, split: boolean) {
  const children = Array.from(root.children);
  const selector = split ? '.setdown-rendered-diff-row' : '.setdown-diff-cell';
  if (!patch || !integer(patch.baseLength) || !integer(patch.length)
    || children.length !== patch.baseLength || children.some((row) => !row.matches(selector))
    || !Array.isArray(patch.splices) || !Array.isArray(patch.shifts)) {
    throw new Error('Review row base does not match the installed DOM.');
  }
  const removed = new Set<number>(); let edge = 0; let length = children.length;
  const inserts: Element[] = [];
  const mathPlans: ReturnType<typeof prepareReviewMathRow>[] = [];
  const usedMath = new Set<Element>();
  const operations = patch.splices.map((splice, operationIndex) => {
    if (!splice || !integer(splice.from) || !integer(splice.removeCount)
      || (operationIndex > 0 && splice.from <= edge) || splice.from + splice.removeCount > children.length
      || !Array.isArray(splice.rows) || splice.rows.some((row) => typeof row !== 'string')) {
      throw new Error('Invalid review row splice.');
    }
    edge = splice.from + splice.removeCount;
    for (let index = splice.from; index < edge; index++) removed.add(index);
    const fragment = document.createDocumentFragment();
    const oldRows = children.slice(splice.from, edge);
    for (const [rowIndex, html] of splice.rows.entries()) {
      // Bound cross-row matching on restructures; an ordinary replacement only
      // inspects its own row, not the entire document or other live panes.
      const candidates = splice.rows.length === oldRows.length ? [oldRows[rowIndex]]
        : oldRows.length <= 8 && splice.rows.length <= 8 ? oldRows : [];
      const plan = prepareReviewMathRow(html, candidates, usedMath);
      const holder = plan.holder;
      mathPlans.push(plan);
      const row = holder.content.firstElementChild;
      if (holder.content.children.length !== 1 || !row?.matches(selector)) {
        throw new Error('Invalid rendered review row.');
      }
      inserts.push(row); fragment.append(row);
    }
    length += splice.rows.length - splice.removeCount;
    return { ...splice, fragment };
  });
  if (length !== patch.length) throw new Error('Review row count mismatch.');
  let shiftedEdge = 0;
  for (const shift of patch.shifts) {
    if (!shift || !integer(shift.from) || !integer(shift.count) || shift.count === 0
      || shift.from < shiftedEdge || shift.from + shift.count > children.length
      || !Array.isArray(shift.deltas) || shift.deltas.length !== (split ? 2 : 1)
      || shift.deltas.some((delta) => !Number.isSafeInteger(delta))) {
      throw new Error('Invalid review source metadata shift.');
    }
    shiftedEdge = shift.from + shift.count;
    for (let index = shift.from; index < shiftedEdge; index++) {
      if (removed.has(index)) throw new Error('A removed review row cannot retain metadata.');
      if (split && (children[index].children.length !== 2
        || !children[index].children[0].matches('.setdown-rendered-diff-before')
        || !children[index].children[1].matches('.setdown-rendered-diff-after'))) {
        throw new Error('Review sides do not match.');
      }
    }
  }
  return { inserts, reusedMath: mathPlans.reduce((sum, plan) => sum + plan.reusedMath, 0), replacedRows: removed.size, retainedRows: children.length - removed.size,
    apply() {
      // Both trees have passed validation. Until this point no live math moved.
      for (const plan of mathPlans) plan.commit();
      // Never reparent unchanged rows. Preserve DOM identity and local UI state.
      for (const splice of [...operations].reverse()) {
        const anchor = children[splice.from + splice.removeCount] ?? null;
        for (let index = splice.from; index < splice.from + splice.removeCount; index++) children[index].remove();
        root.insertBefore(splice.fragment, anchor);
      }
      for (const shift of patch.shifts) {
        for (let index = shift.from; index < shift.from + shift.count; index++) {
          const cells = split ? Array.from(children[index].children) : [children[index]];
          cells.forEach((cell, side) => shiftCell(cell, shift.deltas[side]));
        }
      }
    } };
}
/** No focus or scroll writes; wrapper and unchanged paragraph/math nodes survive. */
export function applyReviewRowsPatch(root: HTMLElement, patch: ReviewRowsPatch, installedRevision: number) {
  if (!patch || patch.version !== 1 || patch.baseRevision !== installedRevision
    || !integer(patch.revision) || patch.revision <= installedRevision) {
    throw new Error('Obsolete review row patch.');
  }
  const wrappers = Array.from(root.children);
  if (wrappers.length !== 2 || !wrappers[0].matches('.setdown-rendered-diff-unified')
    || !wrappers[1].matches('.setdown-rendered-diff-split')) throw new Error('Review wrappers are not installed.');
  const unified = prepareTree(wrappers[0], patch.unified, false);
  const split = prepareTree(wrappers[1], patch.split, true);
  unified.apply(); split.apply();
  return { reusedMath: unified.reusedMath + split.reusedMath, inserted: [...unified.inserts, ...split.inserts],
    replacedRows: unified.replacedRows + split.replacedRows,
    retainedRows: unified.retainedRows + split.retainedRows };
}
