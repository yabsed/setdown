import { expect, test } from 'vitest';
import { browserFailure, browserFailureMessage } from './browser-failure';
test.each([[-202, 'certificate'], [-106, 'offline'], [-105, 'dns'], [-118, 'timeout'], [-102, 'connection'], [-2, 'other']])('classifies Chromium failure %s without changing its URL', (code, kind) => {
  const failure = browserFailure('https://example.com/original?q=1', Number(code));
  expect(failure).toEqual({ kind, code, url: 'https://example.com/original?q=1' });
  expect(browserFailureMessage(failure)).toBeTruthy();
});
