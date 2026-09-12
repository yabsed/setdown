/**
 * Viewer(HTML)와 Editor(Markdown)를 잇는 단 하나의 좌표계.
 *
 * 규칙은 하나다. 어떤 입력이 들어와도 anchor를 돌려준다.
 * `resolveViewerPoint()`와 `resolveEditorViewport()`는 `null`을 반환하지 않는
 * total function이며, `confidence`는 시험과 진단을 위한 값일 뿐 화면 전환을
 * 취소하는 스위치가 아니다.
 */

/**
 * anchor를 어떤 근거로 얻었는지 나타낸다. 사다리의 여섯 단계에 대응한다.
 *
 * 1. `exact-range`   자신/조상이 source range(행·열 또는 행 범위)를 갖고 있다.
 * 2. `ancestor-line` 자신/조상이 `data-source-line`만 갖고 있다.
 * 3. `descendant-line` 클릭 좌표에 가장 가까운 후손의 행을 썼다.
 * 4. `neighbor-interpolation` 앞뒤 anchor 사이를 화면 높이로 보간했다.
 * 5. `nearest-visual` DOM 순서를 믿을 수 없어 화면 거리로 골랐다.
 * 6. `scroll-ratio` / `empty-document` 마지막 안전망.
 */
export type AnchorReason =
  | 'exact-range'
  | 'ancestor-line'
  | 'descendant-line'
  | 'neighbor-interpolation'
  | 'nearest-visual'
  | 'scroll-ratio'
  | 'empty-document';

export type AnchorConfidence = 'exact' | 'near' | 'fallback';

export type ViewportAnchor = {
  /** 항상 1 이상, 문서 행 수 이하. */
  sourceLine: number;
  /** 알 수 있을 때만. */
  sourceColumn?: number;
  /** block 범위를 알 수 있을 때만. 마지막 행을 포함한다. */
  sourceEndLine?: number;
  /** viewport 안의 세로 위치, 0~1. */
  yRatio: number;
  reason: AnchorReason;
  confidence: AnchorConfidence;
};

export type AnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** DOM에서 걷어 온 하나의 source anchor 후보. 좌표는 viewport 기준이다. */
export type SourceCandidate = {
  line: number;
  endLine?: number;
  column?: number;
  /** 문서 순서. 화면 순서와 어긋날 수 있다. */
  order: number;
  rect: AnchorRect;
};

export type ViewerPointRequest = {
  point: { x: number; y: number };
  viewportHeight: number;
  lineCount: number;
  /** 가까운 조상부터. 사다리 1단계. */
  ancestors: SourceCandidate[];
  /** 클릭 대상의 후손. 사다리 2단계. */
  descendants: SourceCandidate[];
  /** 본문 전체의 anchor, 문서 순서. 사다리 3~5단계. */
  candidates: SourceCandidate[];
  /** 문서 전체 scroll 진행도, 0~1. 사다리 5단계. */
  scrollRatio: number;
  /** 시각적 내용이 없는 문서인가. 사다리 6단계. */
  documentIsBlank: boolean;
};

export const GOLDEN_TOP_RATIO = 0.372;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, low: number, high: number): number {
  const safe = finite(value, low);
  return safe < low ? low : safe > high ? high : safe;
}

function isUsable(candidate: SourceCandidate | undefined | null): candidate is SourceCandidate {
  return !!candidate && Number.isFinite(candidate.line) && candidate.line >= 1;
}

function rectDistance(rect: AnchorRect, x: number, y: number): number {
  const dx = rect.left > x ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = rect.top > y ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  // 세로 어긋남이 가로 어긋남보다 더 큰 오류다. 문서는 세로로 흐른다.
  return Math.sqrt(dx * dx + dy * dy * 4);
}

function nearest(candidates: SourceCandidate[], x: number, y: number): SourceCandidate | null {
  let best: SourceCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestHeight = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isUsable(candidate)) continue;
    const distance = rectDistance(candidate.rect, x, y);
    const height = Math.max(0, candidate.rect.bottom - candidate.rect.top);
    // 거리가 같다면 더 좁은 rect가 더 구체적인 답이다. 겹쳐 있는
    // blockquote > ul > li 중에서 li를 고르기 위한 규칙이다.
    if (distance < bestDistance || (distance === bestDistance && height < bestHeight)) {
      best = candidate;
      bestDistance = distance;
      bestHeight = height;
    }
  }
  return best;
}

/** anchor가 실제로 차지하는 마지막 행. */
function lastLineOf(candidate: SourceCandidate): number {
  const end = finite(candidate.endLine, candidate.line);
  return Math.max(candidate.line, end);
}

/**
 * 화면의 한 점을 Markdown 위치로 옮긴다. 절대 실패하지 않는다.
 */
export function resolveViewerPoint(request: ViewerPointRequest): ViewportAnchor {
  const lineCount = Math.max(1, Math.round(finite(request?.lineCount, 1)));
  const viewportHeight = Math.max(1, finite(request?.viewportHeight, 1));
  const x = finite(request?.point?.x, 0);
  const y = finite(request?.point?.y, 0);
  const yRatio = clamp(y / viewportHeight, 0, 1);
  const candidates = (request?.candidates ?? []).filter(isUsable);

  const settle = (
    line: number,
    reason: AnchorReason,
    confidence: AnchorConfidence,
    extra: { column?: number; endLine?: number } = {},
  ): ViewportAnchor => {
    const sourceLine = clamp(Math.round(line), 1, lineCount);
    const anchor: ViewportAnchor = { sourceLine, yRatio, reason, confidence };
    if (Number.isFinite(extra.column) && (extra.column as number) >= 1) {
      anchor.sourceColumn = Math.round(extra.column as number);
    }
    if (Number.isFinite(extra.endLine)) {
      const endLine = clamp(Math.round(extra.endLine as number), sourceLine, lineCount);
      if (endLine > sourceLine) anchor.sourceEndLine = endLine;
    }
    return anchor;
  };

  // 6. 빈 문서. 원문에 행이 하나뿐이라면 어디를 눌러도 답은 1행 1열이다.
  //    사다리를 내려갈 필요도 없다.
  if (request?.documentIsBlank && lineCount <= 1) {
    return settle(1, 'empty-document', 'exact', { column: 1 });
  }

  // 1. source range가 붙은 자신 또는 조상.
  const ancestor = (request?.ancestors ?? []).find(isUsable);
  if (ancestor) {
    const hasRange = Number.isFinite(ancestor.column) || Number.isFinite(ancestor.endLine);
    return settle(
      ancestor.line,
      hasRange ? 'exact-range' : 'ancestor-line',
      Number.isFinite(ancestor.column) ? 'exact' : 'near',
      ancestor,
    );
  }

  // 2. 후손의 source range. 첫 번째가 아니라 클릭 좌표에 가장 가까운 것.
  const descendant = nearest((request?.descendants ?? []).filter(isUsable), x, y);
  if (descendant) {
    return settle(descendant.line, 'descendant-line', 'near', descendant);
  }

  // 4. 클릭 높이를 실제로 덮고 있는 anchor. 문단 바깥 여백을 눌렀거나
  //    absolute positioning 때문에 DOM 순서를 믿을 수 없을 때다.
  const straddling = candidates.filter(
    (candidate) => candidate.rect.top <= y && y <= candidate.rect.bottom,
  );
  if (straddling.length > 0) {
    const closest = nearest(straddling, x, y);
    if (closest) {
      return settle(closest.line, 'nearest-visual', 'near', closest);
    }
  }

  // 3. 앞뒤 anchor 사이의 보간.
  if (candidates.length > 0) {
    let previous: SourceCandidate | null = null;
    let next: SourceCandidate | null = null;
    for (const candidate of candidates) {
      if (candidate.rect.bottom <= y) {
        if (!previous || candidate.rect.bottom > previous.rect.bottom) previous = candidate;
      } else if (candidate.rect.top >= y) {
        if (!next || candidate.rect.top < next.rect.top) next = candidate;
      }
    }

    if (previous && next) {
      const gapStart = lastLineOf(previous) + 1;
      const gapEnd = next.line - 1;
      if (gapEnd < gapStart) {
        return settle(lastLineOf(previous), 'neighbor-interpolation', 'fallback');
      }
      const span = Math.max(1, next.rect.top - previous.rect.bottom);
      const travelled = clamp((y - previous.rect.bottom) / span, 0, 1);
      const line = gapStart + Math.floor(travelled * (gapEnd - gapStart + 1));
      return settle(Math.min(line, gapEnd), 'neighbor-interpolation', 'fallback');
    }
    if (previous) {
      // 문서 끝 여백. 마지막 block 뒤로 간다.
      return settle(lastLineOf(previous), 'neighbor-interpolation', 'fallback');
    }
    if (next) {
      // 첫 block 위의 여백. front matter가 있다면 그 안이다.
      return settle(next.line - 1, 'neighbor-interpolation', 'fallback');
    }

    // 세로로 겹치지도, 앞뒤로 놓이지도 않는 경우. 화면에서 가장 가까운 anchor.
    const closest = nearest(candidates, x, y);
    if (closest) {
      return settle(closest.line, 'nearest-visual', 'fallback', closest);
    }
  }

  // 5. 전체 scroll ratio.
  const ratio = clamp(finite(request?.scrollRatio, 0), 0, 1);
  return settle(1 + ratio * (lineCount - 1), 'scroll-ratio', 'fallback');
}

/** 화면 안에 보이는 cursor. 화면 밖이면 probe에서 null이다. */
export type EditorCursorProbe = {
  line: number;
  column?: number;
  /** viewport 안 cursor의 세로 위치, 0~1. */
  yRatio: number;
};

export type EditorViewportProbe = {
  /** viewport의 기준선에 실제로 보이는 행. 알 수 없으면 null. */
  probedLine: number | null;
  /** 그마저 없을 때 쓸 첫 가시 행. */
  firstVisibleLine: number | null;
  lineCount: number;
  yRatio: number;
  /** 화면 안에 cursor가 있을 때만. 화면 밖이면 null. */
  cursor?: EditorCursorProbe | null;
};

/**
 * Editor 화면을 Markdown 위치로 옮긴다.
 *
 * cursor가 화면 안에 있으면 그 자리를 그대로 옮긴다. 기준선을 고정하면
 * 기준선에서 cursor까지의 거리만큼 Editor와 Viewer의 줄 높이 차이가 누적되어,
 * 방금 고친 자리가 화면 밖으로 밀려난다. cursor가 화면 밖이면 사용자가 보고
 * 있는 것은 cursor가 아니라 화면이므로 기준선을 쓴다.
 */
export function resolveEditorViewport(probe: EditorViewportProbe): ViewportAnchor {
  const lineCount = Math.max(1, Math.round(finite(probe?.lineCount, 1)));
  const yRatio = clamp(finite(probe?.yRatio, GOLDEN_TOP_RATIO), 0, 1);
  const probed = finite(probe?.probedLine, Number.NaN);
  const firstVisible = finite(probe?.firstVisibleLine, Number.NaN);

  const cursorLine = finite(probe?.cursor?.line, Number.NaN);
  if (probe?.cursor && Number.isFinite(cursorLine) && cursorLine >= 1) {
    const anchor: ViewportAnchor = {
      sourceLine: clamp(Math.round(cursorLine), 1, lineCount),
      yRatio: clamp(finite(probe.cursor.yRatio, yRatio), 0, 1),
      reason: 'exact-range',
      confidence: 'exact',
    };
    const column = finite(probe.cursor.column, Number.NaN);
    if (Number.isFinite(column) && column >= 1) anchor.sourceColumn = Math.round(column);
    return anchor;
  }

  if (Number.isFinite(probed) && probed >= 1) {
    return {
      sourceLine: clamp(Math.round(probed), 1, lineCount),
      yRatio,
      reason: 'exact-range',
      confidence: 'near',
    };
  }
  if (Number.isFinite(firstVisible) && firstVisible >= 1) {
    return {
      sourceLine: clamp(Math.round(firstVisible), 1, lineCount),
      yRatio,
      reason: 'neighbor-interpolation',
      confidence: 'fallback',
    };
  }
  return { sourceLine: 1, yRatio, reason: 'empty-document', confidence: 'fallback' };
}

/** 어떤 anchor든 모델의 행 수 안으로 접는다. */
export function clampAnchor(anchor: ViewportAnchor, lineCount: number): ViewportAnchor {
  const total = Math.max(1, Math.round(finite(lineCount, 1)));
  const sourceLine = clamp(Math.round(finite(anchor?.sourceLine, 1)), 1, total);
  const clamped: ViewportAnchor = {
    sourceLine,
    yRatio: clamp(finite(anchor?.yRatio, GOLDEN_TOP_RATIO), 0, 1),
    reason: anchor?.reason ?? 'scroll-ratio',
    confidence: anchor?.confidence ?? 'fallback',
  };
  if (Number.isFinite(anchor?.sourceColumn) && (anchor.sourceColumn as number) >= 1) {
    clamped.sourceColumn = Math.round(anchor.sourceColumn as number);
  }
  if (Number.isFinite(anchor?.sourceEndLine)) {
    clamped.sourceEndLine = clamp(Math.round(anchor.sourceEndLine as number), sourceLine, total);
  }
  return clamped;
}
