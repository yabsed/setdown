import { expect, test, vi } from 'vitest';
import { languageFailure, languageResult, LanguageRequestError, requestLanguageResult } from './language-request';

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
test('JSON-RPC code and cancellation data survive structured serialization', () => {
  const reply = JSON.parse(JSON.stringify(languageFailure(Object.assign(Error('cancelled'), { code: -32802, data: { retriggerRequest: false } }))));
  expect(() => languageResult(reply)).toThrow(LanguageRequestError);
  try { languageResult(reply); } catch (error) { expect(error).toMatchObject({ code: -32802, data: { retriggerRequest: false } }); }
  expect(() => languageFailure(Error('ordinary failure'))).toThrow('ordinary failure');
});
test('semantic tokens retrigger server cancellation, while diagnostics honor retriggerRequest=false and edits never repeat', async () => {
  const cancelled = languageFailure(Object.assign(Error('busy'), { code: -32802 }));
  const send = vi.fn().mockResolvedValueOnce(cancelled).mockResolvedValueOnce({ data: [0, 0, 1, 0, 0] });
  expect(await requestLanguageResult('textDocument/semanticTokens/full', send, () => true, token)).toEqual({ data: [0, 0, 1, 0, 0] });
  expect(send).toHaveBeenCalledTimes(2);
  for (const method of ['textDocument/rename', 'workspace/executeCommand', 'textDocument/diagnostic']) {
    const call = vi.fn(async () => languageFailure(Object.assign(Error('cancelled'), { code: -32802, data: { retriggerRequest: false } })));
    await expect(requestLanguageResult(method, call, () => true, token)).rejects.toThrow(LanguageRequestError);
    expect(call).toHaveBeenCalledOnce();
  }
});
test('retriggering stops at a changed revision and a bounded number of server cancellations', async () => {
  const cancelled = languageFailure(Object.assign(Error('busy'), { code: -32802 }));
  let alive = true;
  const changed = vi.fn(async () => { alive = false; return cancelled; });
  expect(await requestLanguageResult('textDocument/diagnostic', changed, () => alive, token)).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
  const busy = vi.fn(async () => cancelled);
  await expect(requestLanguageResult('textDocument/semanticTokens/range', busy, () => true, token)).rejects.toThrow(LanguageRequestError);
  expect(busy).toHaveBeenCalledTimes(3);
});

test('a cancellation listener that fires synchronously stops retriggering without leaking its subscription', async () => {
  let cancelled = false;
  const dispose = vi.fn();
  const token = { get isCancellationRequested() { return cancelled; }, onCancellationRequested: (listener: () => void) => {
    cancelled = true; listener(); return { dispose };
  } };
  const send = vi.fn(async () => languageFailure(Object.assign(Error('busy'), { code: -32802 })));
  expect(await requestLanguageResult('textDocument/diagnostic', send, () => true, token)).toBeNull();
  expect(send).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
});
