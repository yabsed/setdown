import { responsiveRenderedDiff, RENDERED_DIFF_STYLES } from '../../core/preview/rendered-diff';
import { canInlineInitialHtml, replaceInitialPreviewHtml } from '../../core/preview/preview-install';
import type { ReviewAssembly } from './review-render-client';
import { ReviewRowCache } from './review-row-cache';

// Crossnote already sanitized the fragments. Preserve the existing alignment,
// emphasis, before/after anchors and unsupported-client-runtime behavior.
const rows = new ReviewRowCache();
const port = process.parentPort;
port.on('message', ({ data }: { data: (ReviewAssembly & { id: number })
  | { kind: 'forget'; pageKey: string }
  | { kind: 'seed'; sourceKey: string; targetKey: string; revision: number } }) => {
  if ('kind' in data) {
    if (data.kind === 'forget') rows.forget(data.pageKey);
    else rows.seed(data.sourceKey, data.targetKey, data.revision);
    return;
  }
  try {
    const html = responsiveRenderedDiff(data.originalHtml, data.modifiedHtml, []);
    if (!canInlineInitialHtml(html)) {
      port.postMessage({ id: data.id, ok: true, supported: false });
      return;
    }
    const installed = data.needsTemplate && data.template
      ? replaceInitialPreviewHtml(data.template, html) : null;
    if (data.needsTemplate && !installed) {
      port.postMessage({ id: data.id, ok: true, supported: false });
      return;
    }
    const update = rows.update(data.pageKey, data.needsTemplate ? null : data.baseRevision, data.revision, html);
    port.postMessage({ id: data.id, ok: true, supported: true, ...update,
      template: installed ? installed.replace('</head>', `${RENDERED_DIFF_STYLES}</head>`) : undefined });
  } catch (error) {
    port.postMessage({ id: data.id, ok: false, supported: false,
      error: error instanceof Error ? error.message : String(error) });
  }
});
