import type { AnalysisSelection, DocumentAnalysis } from '../../core/document/analysis-context';
import { documentSupport, type DocumentSupport, type DocumentSupportTarget } from './document-support';

export type AnalysisState = { context?: DocumentAnalysis; busy: boolean; preparing: boolean; error: string; output: string };
/** One inspection owns one document incarnation, even across tab switches. */
export class DocumentAnalysisController {
  state: AnalysisState = { busy: false, preparing: false, error: '', output: '' };
  private epoch = 0;
  private live = true;
  constructor(readonly target: DocumentSupportTarget, private readonly changed: (state: AnalysisState) => void) {}
  private publish(patch: Partial<AnalysisState>) { this.state = { ...this.state, ...patch }; this.changed(this.state); }
  private async run(action: (support: DocumentSupport) => Promise<Partial<AnalysisState>>, preparing = false): Promise<boolean> {
    if (!this.live || this.state.busy) return false;
    const support = documentSupport.current(this.target);
    if (!support) return false;
    const request = ++this.epoch;
    const current = () => this.live && request === this.epoch && !!documentSupport.current(this.target);
    this.publish({ busy: true, preparing, error: '' });
    try {
      const result = await action(support);
      if (!current()) return false;
      this.publish(result); return true;
    } catch (error) {
      if (current()) this.publish({ error: String(error) });
      return false;
    } finally { if (this.live && request === this.epoch) this.publish({ busy: false, preparing: false }); }
  }
  refresh() { return this.run(async support => ({ context: await support.environment() })); }
  select(selection: AnalysisSelection) { return this.run(async support => ({ context: await support.selectEnvironment({ ...selection, root: this.state.context?.root }) })); }
  prepare() {
    return this.run(async support => {
      const result = await support.prepareEnvironment();
      if (!this.live || !documentSupport.current(this.target)) return {};
      return { output: result.output || 'Project configured.', context: await support.environment() };
    }, true);
  }
  async cancel() {
    try { await documentSupport.current(this.target)?.cancelPreparation(); }
    catch (error) { if (this.live) this.publish({ error: String(error) }); }
  }
  dispose() { this.live = false; this.epoch++; }
}
