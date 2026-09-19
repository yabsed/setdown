import { responsiveRenderedDiff, RENDERED_DIFF_STYLES } from '../../core/preview/rendered-diff';
import { replaceInitialPreviewHtml } from '../../core/preview/preview-install';
import type { ReviewAssembly } from './review-render-client';

// Crossnote already sanitized the fragments. Preserve the existing alignment,
// emphasis, before/after anchors and unsupported-client-runtime behavior.
const port = process.parentPort;
port.on('message', ({ data }: { data: ReviewAssembly & { id: number } }) => {
  try {
    const html = responsiveRenderedDiff(data.originalHtml, data.modifiedHtml, []);
    const installed = replaceInitialPreviewHtml(data.template, html);
    if (!installed) {
      port.postMessage({ id: data.id, ok: true, supported: false });
      return;
    }
    port.postMessage({
      id: data.id, ok: true, supported: true, html,
      template: data.needsTemplate ? installed.replace('</head>', `${RENDERED_DIFF_STYLES}</head>`) : undefined,
    });
  } catch (error) {
    port.postMessage({ id: data.id, ok: false, supported: false,
      error: error instanceof Error ? error.message : String(error) });
  }
});
