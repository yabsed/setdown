import type { _electron as electron } from '@playwright/test';

type Application = Awaited<ReturnType<typeof electron.launch>>;

/** 창을 고르는 방법. 순서로 고르거나 제목의 일부로 고른다. */
export type WindowSelector = number | { title: string };

type Query =
  | { kind: 'count' }
  | { kind: 'urls' }
  | { kind: 'visibleUrl' }
  | { kind: 'hasVisible' }
  | { kind: 'visibleBounds' }
  | { kind: 'evaluateVisible'; script: string }
  | { kind: 'evaluateAll'; script: string };

/**
 * Preview를 다루는 e2e 헬퍼.
 *
 * Preview는 renderer 안의 iframe이 아니라 창에 붙은 별도 `WebContentsView`다.
 * 그래서 `page.frames()`나 `.preview-frame` 같은 DOM 선택자로는 닿지 않고,
 * 메인 프로세스를 거쳐 `contentView.children`에서 찾아야 한다.
 *
 * 두 가지를 항상 걸러 준다.
 *
 * - **예비(warmup) view**: 다음 탭이 쓸 페이지를 미리 부팅해 둔 것이다. 본문이
 *   비어 있어서 스크롤도 안 되고 내용도 없다. 이것을 실제 문서로 착각하면
 *   시험이 엉뚱한 대상을 재게 된다.
 * - **비활성 탭의 view**: 탭마다 view가 하나씩 살아 있다. 크기가 0이거나 옛
 *   내용을 들고 있으므로, 화면에 보이는 것을 골라야 한다.
 */
export function previews(application: Application, window: WindowSelector = 0) {
  const ask = <T>(query: Query): Promise<T> => application.evaluate(
    async ({ BrowserWindow }, [selector, request]) => {
      const windows = BrowserWindow.getAllWindows();
      const owner = typeof selector === 'number'
        ? windows[selector]
        : windows.find((candidate) => candidate.getTitle().includes(selector.title));

      // 실제 문서를 담고 있는 view만 남긴다.
      //
      // 예비 view는 넘겨받은 뒤에도 navigate하지 않으므로 warmup 이름을 그대로
      // 지닌 채 문서를 담게 된다. 그래서 이름만으로는 가를 수 없다. 아직 쓰이지
      // 않은 예비는 화면에 드러나는 일이 없으므로, warmup 이름은 "숨겨져 있을
      // 때만" 제외한다.
      const views = (owner?.contentView.children ?? []).filter((candidate) => {
        if (!('webContents' in candidate)) return false;
        const url = candidate.webContents.getURL();
        if (!url.startsWith('marktex-preview://document/')) return false;
        return !url.includes('/warmup-') || candidate.getVisible();
      }) as Electron.WebContentsView[];
      const visible = views.find((candidate) => candidate.getVisible());

      const run = (view: Electron.WebContentsView | undefined, script: string) =>
        view ? view.webContents.executeJavaScript(script).catch(() => null) : null;

      switch (request.kind) {
        case 'count':
          return views.length;
        case 'urls':
          return views.map((view) => view.webContents.getURL());
        case 'visibleUrl':
          return visible ? visible.webContents.getURL() : null;
        case 'hasVisible':
          return !!visible;
        case 'visibleBounds':
          return visible ? visible.getBounds() : null;
        case 'evaluateAll':
          return Promise.all(views.map((view) => run(view, request.script)));
        case 'evaluateVisible':
        default:
          // 보이는 것이 없으면 첫 view로 물러선다. 편집 모드에서는 모든
          // Preview가 숨겨져 있지만 내용은 확인할 수 있어야 한다.
          return run(visible ?? views[0], request.script);
      }
    },
    [window, query] as [WindowSelector, Query],
  ) as Promise<T>;

  return {
    /** 이 창이 들고 있는 문서 Preview의 수. 탭 수와 같다. */
    count: () => ask<number>({ kind: 'count' }),

    /** 각 Preview가 띄우고 있는 문서 URL. 탭 순서를 따른다. */
    urls: () => ask<string[]>({ kind: 'urls' }),

    /** 드러난 Preview가 띄우고 있는 문서 URL. 활성 탭의 것이다. */
    visibleUrl: () => ask<string | null>({ kind: 'visibleUrl' }),

    /** 화면에 드러난 Preview가 있는가. "조판은 됐지만 안 보인다"를 잡는다. */
    hasVisible: () => ask<boolean>({ kind: 'hasVisible' }),

    /** 드러난 Preview의 native bounds. DOM placeholder와 맞는지 볼 때 쓴다. */
    visibleBounds: () => ask<Electron.Rectangle | null>({ kind: 'visibleBounds' }),

    /**
     * 드러난 Preview 안에서 스크립트를 돌린다.
     *
     * 함수가 아니라 **문자열**을 넘긴다. 메인 프로세스를 거쳐
     * `executeJavaScript`로 들어가므로 바깥 변수를 잡을 수 없다.
     * 값이 필요하면 `JSON.stringify`로 문자열에 박아 넣는다.
     */
    evaluate: <T>(script: string) => ask<T | null>({ kind: 'evaluateVisible', script }),

    /** 모든 탭의 Preview에서 같은 스크립트를 돌린다. 탭 순서대로 돌려준다. */
    evaluateAll: <T>(script: string) => ask<(T | null)[]>({ kind: 'evaluateAll', script }),
  };
}
