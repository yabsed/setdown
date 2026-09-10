import { describe, expect, test } from 'vitest';
import {
  clampAnchor,
  resolveEditorViewport,
  resolveViewerPoint,
  type SourceCandidate,
  type ViewerPointRequest,
} from './viewport-anchor';

function candidate(
  line: number,
  top: number,
  bottom: number,
  extra: Partial<SourceCandidate> = {},
): SourceCandidate {
  return {
    line,
    order: line,
    rect: { top, bottom, left: 0, right: 600 },
    ...extra,
  };
}

function request(overrides: Partial<ViewerPointRequest> = {}): ViewerPointRequest {
  return {
    point: { x: 300, y: 400 },
    viewportHeight: 800,
    lineCount: 100,
    ancestors: [],
    descendants: [],
    candidates: [],
    scrollRatio: 0,
    documentIsBlank: false,
    ...overrides,
  };
}

describe('사다리 1단계: 자신 또는 조상', () => {
  test('행과 열을 아는 조상은 exact-range다', () => {
    const anchor = resolveViewerPoint(
      request({ ancestors: [candidate(12, 380, 420, { column: 18 })] }),
    );
    expect(anchor).toMatchObject({ sourceLine: 12, sourceColumn: 18, reason: 'exact-range' });
    expect(anchor.confidence).toBe('exact');
  });

  test('block 범위를 아는 조상은 끝 행도 나른다', () => {
    const anchor = resolveViewerPoint(
      request({ ancestors: [candidate(5, 380, 460, { endLine: 7 })] }),
    );
    expect(anchor.sourceLine).toBe(5);
    expect(anchor.sourceEndLine).toBe(7);
  });

  test('행만 아는 조상은 ancestor-line이다', () => {
    const anchor = resolveViewerPoint(request({ ancestors: [candidate(3, 380, 420)] }));
    expect(anchor).toMatchObject({ sourceLine: 3, reason: 'ancestor-line', confidence: 'near' });
  });

  test('가장 가까운 조상이 먼 조상을 이긴다', () => {
    const anchor = resolveViewerPoint(
      request({ ancestors: [candidate(9, 390, 410), candidate(2, 100, 700)] }),
    );
    expect(anchor.sourceLine).toBe(9);
  });
});

describe('사다리 2단계: 후손', () => {
  test('첫 번째가 아니라 클릭 좌표에 가장 가까운 후손을 고른다', () => {
    const anchor = resolveViewerPoint(
      request({
        point: { x: 300, y: 700 },
        descendants: [candidate(10, 100, 200), candidate(40, 650, 750)],
      }),
    );
    expect(anchor).toMatchObject({ sourceLine: 40, reason: 'descendant-line' });
  });
});

describe('사다리 3~5단계: 추정', () => {
  test('앞뒤 anchor 사이의 여백은 그 사이 행으로 보간한다', () => {
    // 3행 문단, 5~7행 수식, 9행 문단. 수식에는 source가 없다고 가정한다.
    const anchor = resolveViewerPoint(
      request({
        point: { x: 300, y: 210 },
        candidates: [candidate(3, 100, 200), candidate(9, 400, 460)],
      }),
    );
    expect(anchor.reason).toBe('neighbor-interpolation');
    expect(anchor.sourceLine).toBeGreaterThanOrEqual(4);
    expect(anchor.sourceLine).toBeLessThanOrEqual(8);
  });

  test('문서 끝 여백은 마지막 block으로 간다', () => {
    const anchor = resolveViewerPoint(
      request({
        point: { x: 300, y: 700 },
        candidates: [candidate(3, 100, 200, { endLine: 6 })],
      }),
    );
    expect(anchor).toMatchObject({ sourceLine: 6, reason: 'neighbor-interpolation' });
  });

  test('클릭 높이를 덮는 anchor가 있으면 그것을 쓴다', () => {
    // 문단의 왼쪽 여백을 눌렀다. DOM 조상에는 source가 없다.
    const anchor = resolveViewerPoint(
      request({
        point: { x: 4, y: 150 },
        candidates: [candidate(3, 100, 200), candidate(9, 400, 460)],
      }),
    );
    expect(anchor).toMatchObject({ sourceLine: 3, reason: 'nearest-visual' });
  });

  test('anchor가 하나도 없으면 scroll ratio가 답한다', () => {
    const top = resolveViewerPoint(request({ scrollRatio: 0, lineCount: 401 }));
    const bottom = resolveViewerPoint(request({ scrollRatio: 1, lineCount: 401 }));
    expect(top).toMatchObject({ sourceLine: 1, reason: 'scroll-ratio' });
    expect(bottom).toMatchObject({ sourceLine: 401, reason: 'scroll-ratio' });
  });

  test('빈 문서는 어디를 눌러도 1행 1열이다', () => {
    const anchor = resolveViewerPoint(
      request({ lineCount: 1, documentIsBlank: true, point: { x: 500, y: 780 } }),
    );
    expect(anchor).toMatchObject({ sourceLine: 1, sourceColumn: 1, reason: 'empty-document' });
  });

  test('공백만 있는 여러 행 문서는 scroll ratio로 나뉜다', () => {
    const anchor = resolveViewerPoint(
      request({ lineCount: 9, documentIsBlank: true, scrollRatio: 0.5 }),
    );
    expect(anchor).toMatchObject({ sourceLine: 5, reason: 'scroll-ratio' });
  });
});

describe('total function', () => {
  test('잘못된 data-source-line은 전환을 깨뜨리지 않고 문서 안으로 접힌다', () => {
    const anchor = resolveViewerPoint(
      request({ lineCount: 10, ancestors: [candidate(9999, 0, 10)] }),
    );
    expect(anchor.sourceLine).toBe(10);
  });

  test('망가진 입력에도 anchor를 낸다', () => {
    const broken = {
      point: { x: Number.NaN, y: Number.NaN },
      viewportHeight: 0,
      lineCount: Number.NaN,
      ancestors: [{ line: Number.NaN, order: 0, rect: { top: 0, bottom: 0, left: 0, right: 0 } }],
      descendants: [],
      candidates: [],
      scrollRatio: Number.NaN,
      documentIsBlank: false,
    } as unknown as ViewerPointRequest;
    const anchor = resolveViewerPoint(broken);
    expect(anchor.sourceLine).toBe(1);
    expect(anchor.yRatio).toBeGreaterThanOrEqual(0);
  });

  test('임의의 좌표와 임의의 anchor 목록에도 결과는 [1, lineCount] 안이다', () => {
    let seed = 20260911;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 500; round += 1) {
      const lineCount = 1 + Math.floor(random() * 400);
      const messy: SourceCandidate[] = [];
      for (let index = 0; index < Math.floor(random() * 8); index += 1) {
        const top = random() * 4000 - 1000;
        messy.push({
          line: Math.floor(random() * 600) - 50,
          endLine: random() > 0.5 ? Math.floor(random() * 600) - 50 : undefined,
          column: random() > 0.7 ? Math.floor(random() * 40) - 5 : undefined,
          order: index,
          rect: { top, bottom: top + random() * 300 - 50, left: 0, right: 600 },
        });
      }
      const anchor = resolveViewerPoint(
        request({
          point: { x: random() * 900 - 100, y: random() * 900 - 100 },
          lineCount,
          candidates: messy,
          ancestors: random() > 0.7 ? messy.slice(0, 1) : [],
          descendants: random() > 0.7 ? messy.slice(1, 3) : [],
          scrollRatio: random() * 2 - 0.5,
          documentIsBlank: random() > 0.9,
        }),
      );
      expect(Number.isInteger(anchor.sourceLine)).toBe(true);
      expect(anchor.sourceLine).toBeGreaterThanOrEqual(1);
      expect(anchor.sourceLine).toBeLessThanOrEqual(lineCount);
      expect(anchor.yRatio).toBeGreaterThanOrEqual(0);
      expect(anchor.yRatio).toBeLessThanOrEqual(1);
      if (anchor.sourceEndLine !== undefined) {
        expect(anchor.sourceEndLine).toBeGreaterThanOrEqual(anchor.sourceLine);
        expect(anchor.sourceEndLine).toBeLessThanOrEqual(lineCount);
      }
    }
  });
});

describe('Esc: cursor가 아니라 화면을 읽는다', () => {
  test('viewport probe가 가리키는 행을 쓴다', () => {
    const anchor = resolveEditorViewport({
      probedLine: 300,
      firstVisibleLine: 280,
      lineCount: 500,
      yRatio: 0.372,
    });
    expect(anchor).toMatchObject({ sourceLine: 300, yRatio: 0.372 });
  });

  test('probe가 비면 첫 가시 행으로 내려간다', () => {
    const anchor = resolveEditorViewport({
      probedLine: null,
      firstVisibleLine: 280,
      lineCount: 500,
      yRatio: 0.372,
    });
    expect(anchor.sourceLine).toBe(280);
  });

  test('아무것도 없으면 1행이다', () => {
    const anchor = resolveEditorViewport({
      probedLine: null,
      firstVisibleLine: null,
      lineCount: 500,
      yRatio: 0.372,
    });
    expect(anchor.sourceLine).toBe(1);
  });
});

describe('clampAnchor', () => {
  test('모델 밖의 행을 접는다', () => {
    const anchor = clampAnchor(
      { sourceLine: 900, sourceEndLine: 1000, yRatio: 5, reason: 'exact-range', confidence: 'exact' },
      12,
    );
    expect(anchor).toMatchObject({ sourceLine: 12, sourceEndLine: 12, yRatio: 1 });
  });
});
