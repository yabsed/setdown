/** Hosts that refuse sign-in from embedded Chromium and accept Firefox (Min's UASwitcher). */
export const FIREFOX_SIGN_IN_HOSTS = ['accounts.google.com'] as const;

const PRODUCTS = /\s(?!(?:Mozilla|AppleWebKit|Chrome|Safari)\/)[^\s()/]+\/\S+/g;

/**
 * Chromium's own user agent, as Chrome sends it: no application or Electron
 * product token and no minor version numbers.
 */
export function browserUserAgent(fallback: string): string {
  return fallback.replace(PRODUCTS, '').replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}

/** Firefox ships a major version about every four weeks; 91 was released on 2021-08-10. */
export function firefoxUserAgent(platform: string, now: number): string {
  const version = 91 + Math.max(0, Math.floor((now - 1628553600000) / (4.1 * 7 * 24 * 60 * 60 * 1000)));
  const system = platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

export type RequestHeaderRule = {
  id: number; priority: number;
  action: { type: 'modifyHeaders'; requestHeaders: Array<{ header: string; operation: 'set' | 'remove'; value?: string }> };
  condition: { requestDomains: string[]; resourceTypes: string[] };
};

/**
 * declarativeNetRequest rules for the sign-in hosts. Firefox sends no client
 * hints, so a Firefox user agent goes out without Chromium's.
 */
export function signInHeaderRules(platform: string, now: number, hosts: readonly string[] = FIREFOX_SIGN_IN_HOSTS): RequestHeaderRule[] {
  const hints = ['', '-mobile', '-platform', '-platform-version', '-arch', '-bitness', '-model', '-wow64',
    '-full-version', '-full-version-list', '-form-factors'].map(suffix => `sec-ch-ua${suffix}`);
  return [{ id: 1, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'user-agent', operation: 'set', value: firefoxUserAgent(platform, now) },
      ...hints.map(header => ({ header, operation: 'remove' as const })),
    ] },
    condition: { requestDomains: [...hosts],
      resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'] } }];
}
