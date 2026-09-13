import { describe, expect, it } from 'vitest';
import {
  canInlineInitialHtml,
  createLeanPreviewTemplate,
  requiresCrossnoteInstall,
} from './preview-install';

describe('preview 본문 설치 경로', () => {
  it('서버에서 조판이 끝난 본문은 직접 심는다', () => {
    const html = '<p data-source-line="1">글</p>'
      + '<span class="katex"><span class="katex-mathml">x</span></span>';
    expect(requiresCrossnoteInstall(html)).toBe(false);
    expect(canInlineInitialHtml(html)).toBe(true);
  });

  it('브라우저에서 그리는 도해는 crossnote의 초기화로 보낸다', () => {
    expect(requiresCrossnoteInstall('<div class="mermaid">graph TD;</div>')).toBe(true);
    expect(requiresCrossnoteInstall('<div class="wavedrom">{}</div>')).toBe(true);
    expect(requiresCrossnoteInstall('<div class="vega-lite">{}</div>')).toBe(true);
    expect(requiresCrossnoteInstall('<script type="text/tikz">\\draw;</script>')).toBe(true);
    expect(canInlineInitialHtml('<div class="mermaid">graph TD;</div>')).toBe(false);
  });

  it('이스케이프된 본문 텍스트는 도해로 오해하지 않는다', () => {
    const html = '<pre><code>&lt;div class=&quot;mermaid&quot;&gt;</code></pre>';
    expect(requiresCrossnoteInstall(html)).toBe(false);
  });

  it('닫는 template 태그가 든 본문은 template으로 실어 보내지 않는다', () => {
    const html = '<p>&lt;template&gt;</p></template>';
    expect(canInlineInitialHtml(html)).toBe(false);
    // 그래도 갱신 경로에서는 직접 심을 수 있다. template을 쓰지 않기 때문이다.
    expect(requiresCrossnoteInstall(html)).toBe(false);
  });

  it('Crossnote head와 본문만 남긴 lean page를 만든다', () => {
    const template = '<!doctype html><html><head><link rel="stylesheet" href="theme.css">'
      + '<base href="file:///document/"></head><body data-html="encoded"></body>'
      + '<script src="mermaid.js"></script><script src="preview.js"></script></html>';
    const page = createLeanPreviewTemplate(
      template,
      '<p data-source-line="1">본문</p>',
      '<script>window.bridgeInstalled = true;</script>',
    );

    expect(page).toContain('<link rel="stylesheet" href="theme.css">');
    expect(page).toContain('<base href="file:///document/">');
    expect(page).toContain('data-setdown-preview-runtime="lean"');
    expect(page).toContain('<div class="crossnote markdown-preview zen-mode" data-for="preview">');
    expect(page).toContain('<template id="marktex-initial-html">');
    expect(page).toContain('window.bridgeInstalled = true');
    expect(page).not.toContain('data-html="encoded"');
    expect(page).not.toContain('mermaid.js');
    expect(page).not.toContain('preview.js');
  });

  it('head에 script가 있으면 기존 Crossnote page로 물러선다', () => {
    const template = '<html><head><script src="custom.js"></script></head><body></body></html>';
    expect(createLeanPreviewTemplate(template, '<p>본문</p>', '<script>bridge</script>'))
      .toBeNull();
  });
});
