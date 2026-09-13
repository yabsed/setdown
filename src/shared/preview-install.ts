/**
 * 조판된 본문을 Preview에 심는 두 가지 길 중 어느 쪽을 쓸지 고른다.
 *
 * Crossnote의 preview runtime을 거치면 본문이 네 번 지나간다. `data-html`
 * 속성을 풀고, sanitize하고, 숨은 DOM에 innerHTML로 심고, 그것을 다시
 * 문자열로 만들어 보이는 DOM에 심는다. 수식 문서의 1.4MB 본문에서는 그
 * 왕복만 1초에 가까웠다.
 *
 * 워커가 보내는 HTML은 이미 crossnote의 sanitizer(`sanitizeRenderedHTML`)를
 * 통과한 결과다. 그래서 그 길을 건너뛰고 한 번만 파싱해도 안전하다.
 * `marktex:patch-blocks`는 이미 같은 이유로 직접 심고 있다.
 *
 * 다만 crossnote가 브라우저에서 직접 그리는 도해는 그 초기화가 있어야
 * 그려진다. 그런 문서만 예전 길로 보낸다.
 */

/** 브라우저에서 crossnote가 그리는 것들. 서버 조판만으로는 완성되지 않는다. */
const CLIENT_RENDERED = /\bclass="[^"]*\b(?:mermaid|wavedrom|vega|vega-lite)\b|type="text\/tikz"/i;

/** 첫 로드용 `<template>` 안에 넣을 수 없는 본문. 자리에서 닫혀 버린다. */
const CLOSES_TEMPLATE = /<\/template/i;

/**
 * 이 본문을 crossnote의 설치 경로로 보내야 하는가.
 *
 * 참이면 느리지만 crossnote의 초기화가 함께 도는 예전 길을 쓴다.
 */
export function requiresCrossnoteInstall(html: string): boolean {
  return CLIENT_RENDERED.test(html);
}

/** 첫 로드에서 본문을 `<template>`으로 실어 보낼 수 있는가. */
export function canInlineInitialHtml(html: string): boolean {
  return !requiresCrossnoteInstall(html) && !CLOSES_TEMPLATE.test(html);
}

/** 첫 로드 본문을 나르는 `<template>`의 id. 워커가 심고 bridge가 꺼낸다. */
export const INITIAL_HTML_TEMPLATE_ID = 'marktex-initial-html';

/** Preview page가 가진 browser-side renderer의 종류. */
export type PreviewRuntime = 'lean' | 'crossnote';

/**
 * Crossnote가 만든 head는 theme, KaTeX, code highlight CSS의 단일 출처다.
 * 그 head만 보존하고 body 뒤의 범용 diagram/runtime script는 버린다.
 *
 * 본문과 bridge는 앱이 만든 신뢰 경계 안의 문자열이다. 그래도 Crossnote head에
 * script가 생긴 경우에는 조용히 제거하지 않고 full runtime으로 물러선다. 문서별
 * header script를 일부만 실행하는 상태보다 기존 동작을 온전히 유지하는 편이 낫다.
 */
export function createLeanPreviewTemplate(
  crossnoteTemplate: string,
  html: string,
  bridgeScripts: string,
): string | null {
  if (!canInlineInitialHtml(html)) return null;
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(crossnoteTemplate)?.[1];
  if (head === undefined || /<script\b/i.test(head)) return null;
  return `<!DOCTYPE html>
<html>
<head>
${head}
<template id="${INITIAL_HTML_TEMPLATE_ID}">${html}</template>
</head>
<body class="preview-container" data-setdown-preview-runtime="lean">
  <div class="crossnote markdown-preview zen-mode" data-for="preview"></div>
  ${bridgeScripts}
</body>
</html>`;
}
