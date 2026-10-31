import { afterEach, expect, test, vi } from 'vitest';
import { documentSupport, type DocumentSupport } from './document-support';
import { DocumentAnalysisController } from './document-analysis-controller';
import type { DocumentAnalysis } from '../../core/document/analysis-context';
const context: DocumentAnalysis = { id: 'env', root: '/a', rootReason: 'marker', environment: 'usable', choices: [], evidence: [], issues: [], servers: [] };
function document(id: string, resource = id): DocumentSupport {
  return { id, resource, path: '/' + id, language: 'python', name: 'Python', choices: [], providers: [], setLanguage: vi.fn(), restart: vi.fn(), problems: vi.fn(), answerMessage: vi.fn(),
    environment: vi.fn(async () => context), selectEnvironment: vi.fn(async () => context), prepareEnvironment: vi.fn(async () => ({ output: '' })), cancelPreparation: vi.fn(), inspectProvider: vi.fn(), configureProvider: vi.fn() };
}
afterEach(() => { for (const item of documentSupport.all()) documentSupport.remove(item.id); });
test('selection keeps the inspected document and expected project root across another tab becoming active', async () => {
  const a = document('a'), b = document('b'); documentSupport.set(a);
  const controller = new DocumentAnalysisController(a, vi.fn()); await controller.refresh();
  documentSupport.set(b); await controller.select({ kind: 'python', value: 'environment' });
  expect(a.selectEnvironment).toHaveBeenCalledWith({ kind: 'python', value: 'environment', root: '/a' });
  expect(b.selectEnvironment).not.toHaveBeenCalled(); controller.dispose();
});
test('late async responses and actions cannot cross a replaced document or language incarnation', async () => {
  const original = document('a'); let resolve!: (value: DocumentAnalysis) => void;
  original.environment = () => new Promise(done => resolve = done); documentSupport.set(original);
  const controller = new DocumentAnalysisController(original, vi.fn()); const pending = controller.refresh();
  const replacement = document('a', 'another-file'); documentSupport.set(replacement); resolve(context);
  expect(await pending).toBe(false); expect(controller.state.context).toBeUndefined();
  expect(await controller.select({ kind: 'python', value: 'wrong' })).toBe(false);
  expect(replacement.selectEnvironment).not.toHaveBeenCalled(); expect(original.selectEnvironment).not.toHaveBeenCalled();
  controller.dispose();
});
test('closing an inspection ignores pending results without cancelling unrelated work', async () => {
  const original = document('a'); let resolve!: (value: DocumentAnalysis) => void;
  original.environment = () => new Promise(done => resolve = done); documentSupport.set(original);
  const changed = vi.fn(), controller = new DocumentAnalysisController(original, changed); const pending = controller.refresh();
  controller.dispose(); changed.mockClear(); resolve(context); await pending;
  expect(changed).not.toHaveBeenCalled();
});
test('preparation cannot start a follow-up environment lookup after its document was closed', async () => {
  const original = document('a'); let resolve!: (value: { output: string }) => void;
  original.prepareEnvironment = () => new Promise(done => resolve = done); documentSupport.set(original);
  const controller = new DocumentAnalysisController(original, vi.fn()); const pending = controller.prepare();
  documentSupport.remove('a'); resolve({ output: 'done' }); await pending;
  expect(original.environment).not.toHaveBeenCalled(); controller.dispose();
});
