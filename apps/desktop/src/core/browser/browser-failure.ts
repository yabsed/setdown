export type BrowserFailure = { kind: 'certificate' | 'offline' | 'dns' | 'timeout' | 'connection' | 'crash' | 'other'; url: string; code: number };
export function browserFailure(url: string, code: number): BrowserFailure {
  const kind = code <= -200 && code > -300 ? 'certificate' : code === -106 ? 'offline'
    : [-105, -137].includes(code) ? 'dns' : [-7, -118].includes(code) ? 'timeout'
      : code <= -100 && code > -200 ? 'connection' : 'other';
  return { kind, url, code };
}
export function browserFailureMessage(failure: BrowserFailure): string {
  return ({ certificate: 'The site’s certificate could not be verified. Check the address and your device’s date and time.',
    offline: 'You appear to be offline. Check your connection and try again.',
    dns: 'This site’s address could not be found. Check the address and try again.',
    timeout: 'The site took too long to respond. Try again in a moment.',
    connection: 'The connection to this site failed. Check your connection and try again.',
    crash: 'This page stopped unexpectedly. Reload to recover.',
    other: 'The page could not be loaded. Try reloading the original address.' })[failure.kind];
}
