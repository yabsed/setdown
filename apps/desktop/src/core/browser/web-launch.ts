import { isWebURL } from './browser-url';

/**
 * Web addresses among launch arguments: `setdown https://…`, and what the
 * desktop hands to its default browser. Only HTTP(S) addresses without
 * credentials count, so a switch or a file path is never opened as a page.
 */
export function webURLsFromArgs(args: string[]): string[] {
  const urls: string[] = [];
  for (const argument of args.slice(1)) {
    if (!/^https?:\/\//i.test(argument) || !isWebURL(argument)) continue;
    const url = new URL(argument);
    if (url.username || url.password || urls.includes(url.href)) continue;
    urls.push(url.href);
    if (urls.length === 16) break;
  }
  return urls;
}
