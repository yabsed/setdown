import type { PreviewBlock } from './preview-blocks';

export type AlignedPreviewRow = {
  kind: 'equal' | 'replace' | 'delete' | 'insert';
  before: PreviewBlock | null;
  after: PreviewBlock | null;
};

// Bound memory/time in Electron main, including adversarial large documents.
const MAX_EXACT_CELLS = 1_000_000;
const MAX_REPLACEMENT_CELLS = 16_384;
type Match = readonly [number, number];

/** Ordered exact-content anchors. Source-line attributes are absent from block.key. */
function exactMatches(before: PreviewBlock[], after: PreviewBlock[]): Match[] {
  const matches: Match[] = [];
  let start = 0;
  while (start < before.length && start < after.length && before[start].key === after[start].key) {
    matches.push([start, start]);
    start += 1;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1].key === after[newEnd - 1].key) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const n = oldEnd - start;
  const m = newEnd - start;
  if (n && m && (n + 1) * (m + 1) <= MAX_EXACT_CELLS) {
    const stride = m + 1;
    const lengths = new Uint32Array((n + 1) * stride);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lengths[i * stride + j] = before[start + i].key === after[start + j].key
          ? lengths[(i + 1) * stride + j + 1] + 1
          : Math.max(lengths[(i + 1) * stride + j], lengths[i * stride + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (before[start + i].key === after[start + j].key) matches.push([start + i++, start + j++]);
      else if (lengths[(i + 1) * stride + j] >= lengths[i * stride + j + 1]) i += 1;
      else j += 1;
    }
  } else if (n && m) {
    // Patience-style unique anchors + LIS. Repetitions remain conservatively
    // changed when the exact budget is exceeded, never falsely called equal.
    const unique = (blocks: PreviewBlock[], end: number) => {
      const indices = new Map<string, number>();
      for (let i = start; i < end; i += 1) indices.set(blocks[i].key, indices.has(blocks[i].key) ? -1 : i);
      return indices;
    };
    const oldIndices = unique(before, oldEnd);
    const newIndices = unique(after, newEnd);
    const candidates: Match[] = [];
    for (const [key, i] of oldIndices) {
      const j = newIndices.get(key);
      if (i >= 0 && j !== undefined && j >= 0) candidates.push([i, j]);
    }
    const tails: number[] = [];
    const previous = new Int32Array(candidates.length).fill(-1);
    candidates.forEach(([, j], index) => {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (candidates[tails[mid]][1] < j) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) previous[index] = tails[lo - 1];
      tails[lo] = index;
    });
    const chain: Match[] = [];
    for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) chain.push(candidates[index]);
    for (let index = chain.length - 1; index >= 0; index -= 1) matches.push(chain[index]);
  }
  for (let i = oldEnd, j = newEnd; i < before.length; i += 1, j += 1) matches.push([i, j]);
  return matches;
}

function description(block: PreviewBlock) {
  const tag = /^\s*<([\w-]+)/.exec(block.key)?.[1]?.toLowerCase() ?? '';
  // Similarity selects plausible replacements, never decides equality.
  const text = block.key.replace(/<[^>]*>/g, ' ');
  const counts = new Map<string, number>();
  let length = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)) {
    if (length >= 512) break;
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    length += 1;
  }
  return { tag, counts, length };
}

function changedRows(before: PreviewBlock[], after: PreviewBlock[]): AlignedPreviewRow[] {
  const rows: AlignedPreviewRow[] = [];
  const n = before.length;
  const m = after.length;
  if (!n || !m || (n + 1) * (m + 1) > MAX_REPLACEMENT_CELLS) {
    for (const block of before) rows.push({ kind: 'delete', before: block, after: null });
    for (const block of after) rows.push({ kind: 'insert', before: null, after: block });
    return rows;
  }
  const left = before.map(description);
  const right = after.map(description);
  const stride = m + 1;
  const costs = new Float64Array((n + 1) * stride);
  const operations = new Uint8Array(n * m);
  for (let i = 0; i <= n; i += 1) costs[i * stride + m] = n - i;
  for (let j = 0; j <= m; j += 1) costs[n * stride + j] = m - j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      let overlap = 0;
      if (left[i].tag === right[j].tag) {
        for (const [token, count] of left[i].counts) overlap += Math.min(count, right[j].counts.get(token) ?? 0);
      }
      const similarity = 2 * overlap / Math.max(1, left[i].length + right[j].length);
      const same = before[i].key === after[j].key;
      const pairable = same || similarity >= .45 || (n === 1 && m === 1);
      const pair = pairable ? costs[(i + 1) * stride + j + 1] + (same ? 0 : 1.5 - similarity * .5) : Infinity;
      const remove = 1 + costs[(i + 1) * stride + j];
      const insert = 1 + costs[i * stride + j + 1];
      costs[i * stride + j] = Math.min(pair, remove, insert);
      operations[i * m + j] = pair <= remove && pair <= insert ? 0 : remove <= insert ? 1 : 2;
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const operation = i === n ? 2 : j === m ? 1 : operations[i * m + j];
    if (operation === 0) {
      rows.push({ kind: before[i].key === after[j].key ? 'equal' : 'replace', before: before[i++], after: after[j++] });
    } else if (operation === 1) rows.push({ kind: 'delete', before: before[i++], after: null });
    else rows.push({ kind: 'insert', before: null, after: after[j++] });
  }
  return rows;
}

/** Content matching prevents ordinal drift after a whitespace/source-hunk edit. */
export function alignPreviewBlocks(before: PreviewBlock[], after: PreviewBlock[]): AlignedPreviewRow[] {
  const rows: AlignedPreviewRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [i, j] of exactMatches(before, after)) {
    for (const row of changedRows(before.slice(oldIndex, i), after.slice(newIndex, j))) rows.push(row);
    rows.push({ kind: 'equal', before: before[i], after: after[j] });
    oldIndex = i + 1;
    newIndex = j + 1;
  }
  for (const row of changedRows(before.slice(oldIndex), after.slice(newIndex))) rows.push(row);
  return rows;
}
