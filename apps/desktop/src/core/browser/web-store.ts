/** Accept a store listing or its ID, never an arbitrary download URL. */
export function webStoreId(input: unknown): string {
  const invalid = () => new Error('Enter a Chrome Web Store extension link or its 32-character ID.');
  if (typeof input !== 'string' || input.length > 4096) throw invalid();
  const value = input.trim();
  if (/^[a-p]{32}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid();
    const prefix = url.hostname === 'chromewebstore.google.com' ? '/detail/'
      : url.hostname === 'chrome.google.com' ? '/webstore/detail/' : null;
    if (!prefix || !url.pathname.startsWith(prefix)) throw invalid();
    const parts = url.pathname.slice(prefix.length).replace(/\/$/, '').split('/');
    const id = parts.at(-1)!;
    if (parts.length > 2 || !parts.every(Boolean) || !/^[a-p]{32}$/.test(id)) throw invalid();
    return id;
  } catch { throw invalid(); }
}

export const webStoreURL = (id: string) => `https://chromewebstore.google.com/detail/${webStoreId(id)}`;
