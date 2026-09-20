import type { PreviewBlock, PreviewBlockPatch } from '../../core/preview/preview-blocks';
import type { PreviewRuntime } from '../../core/preview/preview-install';

export type InstalledPreview = { blocks: PreviewBlock[]; runtime: PreviewRuntime };
type Request = { tabId: string; html: string; hasPage: boolean; htmlOnly?: boolean };
type Builders = {
  split(html: string): PreviewBlock[];
  diff(before: PreviewBlock[], after: PreviewBlock[]): PreviewBlockPatch | null;
  requiresCrossnote(html: string): boolean;
  leanTemplate(): string | null;
  fullTemplate(): string;
};
type Output = { template?: string; html?: string; patch?: PreviewBlockPatch | null };

/** Select output before doing expensive page/patch work; template builders are lazy. */
export function buildRenderOutput(request: Request, installed: Map<string, InstalledPreview>, builders: Builders): Output {
  const { tabId, html } = request;
  if (request.htmlOnly) {
    // A fragment for comparison/search is not an installed browser document.
    // Do not retain a fictitious block baseline for a later incremental render.
    installed.delete(tabId);
    return { html };
  }
  const blocks = builders.split(html);
  const previous = installed.get(tabId);
  if (!request.hasPage) {
    const lean = builders.leanTemplate();
    const runtime: PreviewRuntime = lean === null ? 'crossnote' : 'lean';
    const template = lean ?? builders.fullTemplate();
    installed.set(tabId, { blocks, runtime });
    return { template, html };
  }
  const runtime = previous?.runtime ?? 'lean';
  if (runtime === 'lean' && builders.requiresCrossnote(html)) {
    const template = builders.fullTemplate();
    installed.set(tabId, { blocks, runtime: 'crossnote' });
    return { template, html };
  }
  const output: Output = previous ? { patch: builders.diff(previous.blocks, blocks) } : { html };
  installed.set(tabId, { blocks, runtime });
  return output;
}
