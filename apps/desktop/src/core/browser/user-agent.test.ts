import { expect, test } from 'vitest';
import { browserUserAgent, firefoxUserAgent, signInHeaderRules } from './user-agent';

test('removes the application and Electron tokens and Chromium minor versions', () => {
  expect(browserUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Setdown/2.9.3 Chrome/156.0.8078.100 Electron/45.3.3 Safari/537.36'))
    .toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
  expect(browserUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.100 Electron/45.3.3 Safari/537.36'))
    .toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
  expect(browserUserAgent(chrome)).toBe(chrome);
});

test('the Firefox version follows the release calendar and never predates its anchor', () => {
  expect(firefoxUserAgent('linux', Date.UTC(2021, 7, 10))).toBe('Mozilla/5.0 (X11; Linux x86_64; rv:91.0) Gecko/20100101 Firefox/91.0');
  expect(firefoxUserAgent('linux', 0)).toContain('Firefox/91.0');
  expect(firefoxUserAgent('win32', Date.UTC(2026, 10, 17))).toMatch(/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64; rv:(\d+)\.0\) Gecko\/20100101 Firefox\/\1\.0$/);
  expect(firefoxUserAgent('darwin', Date.UTC(2026, 10, 17))).toContain('Macintosh; Intel Mac OS X 10.15; rv:158.0');
});

test('sign-in rules replace the user agent and drop client hints only for the sign-in hosts', () => {
  const [rule, ...rest] = signInHeaderRules('linux', Date.UTC(2026, 10, 17));
  expect(rest).toEqual([]);
  expect(rule.condition.requestDomains).toEqual(['accounts.google.com']);
  expect(rule.condition.resourceTypes).toContain('main_frame');
  expect(rule.action.requestHeaders[0]).toEqual({ header: 'user-agent', operation: 'set', value: firefoxUserAgent('linux', Date.UTC(2026, 10, 17)) });
  const removed = rule.action.requestHeaders.slice(1);
  expect(removed.every(item => item.operation === 'remove' && item.header.startsWith('sec-ch-ua'))).toBe(true);
  expect(removed.map(item => item.header)).toEqual(expect.arrayContaining(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-full-version-list']));
  expect(signInHeaderRules('linux', 0, ['signin.test'])[0].condition.requestDomains).toEqual(['signin.test']);
});
