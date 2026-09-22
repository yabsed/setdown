import type { GitGraphCommit } from '@web-git-graph/protocol';
import type { GitGraphLayout } from '@web-git-graph/web';
import type { GitSnapshot } from '../../../protocol/desktop-api';

/** The two refs VS Code's Auto normally follows: HEAD and its upstream. */
export function autoGraphRefs(snapshot: GitSnapshot | null | undefined): string[] {
  if (!snapshot?.repository || !snapshot.branch) return [];
  if (snapshot.branch === 'HEAD' || snapshot.branch.startsWith('(')) return ['HEAD'];
  const refs = [`refs/heads/${snapshot.branch}`];
  if (snapshot.upstream) refs.push(`refs/remotes/${snapshot.upstream}`);
  return refs;
}

export function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Upstream reserves its widest lane across every row. Use its public layout to
 * place each subject after the lanes actually crossing that row instead.
 * Curves reserve both endpoint lanes on both rows, so text cannot cover a bend.
 */
export function graphRowInsets(commits: readonly GitGraphCommit[], layout: GitGraphLayout): number[] {
  const count = commits.length;
  const starts: number[][] = Array.from({ length: count + 1 }, () => []);
  const stops: number[][] = Array.from({ length: count + 1 }, () => []);
  for (const segment of layout.segments) {
    const first = Math.max(0, segment.from.row);
    const last = Math.min(count - 1, segment.to.row);
    if (first > last) continue;
    const lane = Math.max(segment.from.lane, segment.to.lane);
    starts[first]!.push(lane);
    stops[last + 1]!.push(lane);
  }
  const active = Array<number>(layout.laneCount).fill(0);
  return layout.nodes.map((node, row) => {
    for (const lane of stops[row]!) active[lane] = (active[lane] ?? 0) - 1;
    for (const lane of starts[row]!) active[lane] = (active[lane] ?? 0) + 1;
    let lastLane = node.lane;
    for (let lane = active.length - 1; lane > lastLane; lane--) {
      if (active[lane]! > 0) { lastLane = lane; break; }
    }
    // Upstream centers each lane at x = 16 + 16 × lane; leave ~10px after it.
    return 30 + lastLane * 16;
  });
}
