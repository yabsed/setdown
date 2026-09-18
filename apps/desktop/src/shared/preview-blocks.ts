/**
 * 조판된 Preview 본문을 최상위 블록으로 자르고, 두 벌을 대조해 바뀐 구간만
 * 뽑는다.
 *
 * 문서 하나를 통째로 다시 심는 비용은 수식이 많은 문서에서 1~2초였다. 한 줄을
 * 고치면 실제로 바뀌는 것은 100여 개 블록 중 하나뿐이므로, 그 하나만 교체하면
 * 비용이 변경 크기에 비례하게 된다.
 */

/** 자기 자신으로 끝나는 요소. 닫는 태그가 오지 않는다. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 줄 번호를 나르는 속성. 줄이 밀리면 값만 달라지고 내용은 그대로다. */
const SOURCE_ATTRIBUTE = /\s(?:data-source-(?:line|lines|start|end))="[^"]*"/g;

export type PreviewBlock = {
  /** 최상위 요소 하나의 HTML 전체. */
  html: string;
  /** 줄 번호를 지운 비교용 문자열. 줄만 밀린 블록은 이 값이 같다. */
  key: string;
  /** 이 블록이 시작하는 원문 행. 알 수 없으면 null. */
  line: number | null;
};

export function blockKey(html: string): string {
  return html.replace(SOURCE_ATTRIBUTE, '');
}

function firstSourceLine(html: string): number | null {
  const match = /\sdata-source-line="(\d+)"/.exec(html);
  return match ? Number(match[1]) : null;
}

/**
 * 본문 HTML을 최상위 요소 단위로 자른다.
 *
 * 텍스트 안의 `<`는 `&lt;`로 이스케이프되어 오므로 태그 스캔이 안전하다.
 * 다만 속성값 안의 `>`는 구분하지 못한다. crossnote는 그것도 `&gt;`로
 * 내보내므로 실제 출력에서는 문제가 없다.
 */
export function splitPreviewBlocks(html: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let depth = 0;
  let start = -1;
  let index = 0;

  const push = (from: number, to: number) => {
    const piece = html.slice(from, to);
    blocks.push({ html: piece, key: blockKey(piece), line: firstSourceLine(piece) });
  };

  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const closed = html.indexOf('-->', open + 4);
      index = closed < 0 ? html.length : closed + 3;
      continue;
    }
    if (html.startsWith('<!', open)) {
      const closed = html.indexOf('>', open);
      index = closed < 0 ? html.length : closed + 1;
      continue;
    }
    const close = html.indexOf('>', open);
    if (close < 0) break;
    const tag = html.slice(open, close + 1);
    const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)?.[1]?.toLowerCase();
    index = close + 1;
    if (!name) continue;

    if (tag[1] === '/') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          push(start, close + 1);
          start = -1;
        }
      }
      continue;
    }

    const selfClosing = VOID_ELEMENTS.has(name) || /\/>$/.test(tag);
    if (selfClosing) {
      if (depth === 0) push(open, close + 1);
      continue;
    }
    if (depth === 0) start = open;
    depth += 1;
  }
  return blocks;
}

/**
 * 교체할 구간 하나로 표현한 차이.
 *
 * 편집은 국소적이므로 앞뒤의 같은 블록을 걷어내면 가운데 한 구간만 남는다.
 * LCS 없이 양끝에서 좁히는 것으로 삽입·삭제·교체를 모두 담는다.
 */
export type PreviewBlockPatch = {
  /** 교체가 시작되는 최상위 자식의 인덱스. */
  from: number;
  /** 지울 기존 블록 수. */
  removeCount: number;
  /** 새로 넣을 블록들의 HTML. 비어 있으면 삭제만 한다. */
  html: string;
  /** 새로 넣는 블록 수. */
  insertCount: number;
  /**
   * 교체 구간 뒤에 남는 블록들의 `data-source-*`에 더할 값.
   * 줄을 삽입·삭제하면 뒤쪽 블록의 내용은 그대로인 채 줄 번호만 밀린다.
   */
  lineDelta: number;
};

export function diffPreviewBlocks(
  previous: PreviewBlock[],
  next: PreviewBlock[],
): PreviewBlockPatch | null {
  const shortest = Math.min(previous.length, next.length);

  // 접두는 줄 번호까지 같아야 한다. 내용이 같아도 줄이 밀렸다면 그 블록의
  // 속성은 손봐야 하므로 "손대지 않아도 되는 구간"에 넣을 수 없다.
  let head = 0;
  while (
    head < shortest
    && previous[head].key === next[head].key
    && previous[head].line === next[head].line
  ) head += 1;

  // 접미는 내용만 같으면 된다. 줄이 밀린 것은 델타 한 번으로 함께 고친다.
  let tail = 0;
  while (
    tail < shortest - head
    && previous[previous.length - 1 - tail].key === next[next.length - 1 - tail].key
  ) tail += 1;

  const removeCount = previous.length - head - tail;
  const middle = next.slice(head, next.length - tail);

  // 교체 구간 바로 뒤의 같은 블록끼리 줄 번호를 견주어 델타를 얻는다.
  let lineDelta = 0;
  const previousTail = head + removeCount;
  const nextTail = head + middle.length;
  if (previousTail < previous.length && nextTail < next.length) {
    const previousLine = previous[previousTail].line;
    const nextLine = next[nextTail].line;
    if (previousLine !== null && nextLine !== null) lineDelta = nextLine - previousLine;
  }

  if (removeCount === 0 && middle.length === 0 && lineDelta === 0) return null;
  return {
    from: head,
    removeCount,
    html: middle.map((block) => block.html).join('\n'),
    insertCount: middle.length,
    lineDelta,
  };
}
