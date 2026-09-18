import { describe, expect, it } from 'vitest';
import { blockKey, diffPreviewBlocks, splitPreviewBlocks } from './preview-blocks';

describe('splitPreviewBlocks', () => {
  it('최상위 요소 단위로 자른다', () => {
    const blocks = splitPreviewBlocks(
      '<h1 data-source-line="1">제목</h1>\n<p data-source-line="3">본문</p>',
    );
    expect(blocks.map((block) => block.html)).toEqual([
      '<h1 data-source-line="1">제목</h1>',
      '<p data-source-line="3">본문</p>',
    ]);
    expect(blocks.map((block) => block.line)).toEqual([1, 3]);
  });

  it('같은 이름이 중첩되어도 바깥 요소로 자른다', () => {
    const blocks = splitPreviewBlocks(
      '<div data-source-line="1"><div><p>안</p></div></div>\n<div data-source-line="9">뒤</div>',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].html).toBe('<div data-source-line="1"><div><p>안</p></div></div>');
    expect(blocks[1].line).toBe(9);
  });

  it('닫는 태그가 없는 요소도 한 블록이다', () => {
    const blocks = splitPreviewBlocks('<hr data-source-line="4">\n<img src="a.png">');
    expect(blocks.map((block) => block.html))
      .toEqual(['<hr data-source-line="4">', '<img src="a.png">']);
  });

  it('주석은 블록이 아니다', () => {
    const blocks = splitPreviewBlocks('<!-- 메모 -->\n<p data-source-line="2">본문</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(2);
  });

  it('텍스트의 <는 &lt;로 오므로 태그로 세지 않는다', () => {
    const blocks = splitPreviewBlocks('<pre data-source-line="1"><code>&lt;div&gt;</code></pre>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].html).toContain('&lt;div&gt;');
  });
});

describe('blockKey', () => {
  it('줄 번호 속성만 지운다', () => {
    const key = blockKey(
      '<p data-source-line="7" data-source-lines="7-9" class="x">본문'
      + '<span data-source-start="7:3" data-source-end="7:8">수식</span></p>',
    );
    expect(key).toBe('<p class="x">본문<span>수식</span></p>');
  });

  it('줄만 밀린 블록은 같은 key를 낸다', () => {
    const before = blockKey('<p data-source-line="7">같은 내용</p>');
    const after = blockKey('<p data-source-line="9">같은 내용</p>');
    expect(before).toBe(after);
  });
});

describe('diffPreviewBlocks', () => {
  const block = (line: number, body: string) => `<p data-source-line="${line}">${body}</p>`;

  it('같으면 null이다', () => {
    const blocks = splitPreviewBlocks([block(1, 'A'), block(3, 'B')].join('\n'));
    expect(diffPreviewBlocks(blocks, blocks)).toBeNull();
  });

  it('가운데 한 블록만 바뀌면 그 한 칸만 교체한다', () => {
    const previous = splitPreviewBlocks([block(1, 'A'), block(3, 'B'), block(5, 'C')].join('\n'));
    const next = splitPreviewBlocks([block(1, 'A'), block(3, 'B2'), block(5, 'C')].join('\n'));
    expect(diffPreviewBlocks(previous, next)).toMatchObject({
      from: 1, removeCount: 1, insertCount: 1, lineDelta: 0,
    });
  });

  it('블록이 늘면 삽입만 하고 뒤쪽은 줄만 민다', () => {
    const previous = splitPreviewBlocks([block(1, 'A'), block(3, 'C')].join('\n'));
    const next = splitPreviewBlocks([block(1, 'A'), block(3, 'B'), block(5, 'C')].join('\n'));
    const patch = diffPreviewBlocks(previous, next)!;
    expect(patch).toMatchObject({ from: 1, removeCount: 0, insertCount: 1, lineDelta: 2 });
    expect(patch.html).toContain('>B<');
  });

  it('블록이 줄면 삭제만 한다', () => {
    const previous = splitPreviewBlocks([block(1, 'A'), block(3, 'B'), block(5, 'C')].join('\n'));
    const next = splitPreviewBlocks([block(1, 'A'), block(3, 'C')].join('\n'));
    expect(diffPreviewBlocks(previous, next)).toMatchObject({
      from: 1, removeCount: 1, insertCount: 0, lineDelta: -2,
    });
  });

  it('내용은 그대로고 줄만 밀리면 교체 없이 델타만 낸다', () => {
    const previous = splitPreviewBlocks([block(1, 'A'), block(3, 'B')].join('\n'));
    const next = splitPreviewBlocks([block(1, 'A'), block(6, 'B')].join('\n'));
    // 델타를 받아야 하는 것은 인덱스 1의 블록이므로 from은 1이다.
    expect(diffPreviewBlocks(previous, next)).toMatchObject({
      from: 1, removeCount: 0, insertCount: 0, lineDelta: 3,
    });
  });
});
