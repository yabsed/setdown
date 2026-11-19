import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

// In VS Code the editor and not the JSON server downloads a schema. The server is started with
// `handledSchemaProtocols: ['file']`, asks for every other address with the request
// `vscode/content`, and the editor decides whether the address may be fetched, fetches it and
// keeps it on disk. This file is what answers that request in Setdown for http(s) addresses.
// Its rules are carried over from the JSON extension, and each one names the file it came from,
// so a newer `vendor/vscode` can be compared against it. Below
// `vendor/vscode/extensions/json-language-features`:
//   client/src/jsonClient.ts            the `vscode/content` handler, `isTrusted`, the refusals
//   client/src/utils/urlMatch.ts        which addresses an entry of the trusted domains covers
//   client/src/node/jsonClientMain.ts   how a schema is requested, and when the cache answers alone
//   client/src/node/schemaCache.ts      the cache on disk
//   package.json                        the defaults of `json.schemaDownload.*`
// and outside the extension:
//   vendor/vscode/src/vs/base/common/uri.ts   how VS Code reads an address (`URI.parse`, `toString(true)`)
//   vendor/vscode/src/vs/platform/configuration/common/configurationModels.ts   `mergeContents`
//   request-light 0.8.0 (the version the extension locks), lib/node/main.js   what a failed request is called

/** `json.schemaDownload.trustedDomains` as the extension's package.json ships it. The order is
 * part of the rule: the first entry that covers an address decides. */
export const defaultTrustedDomains: Readonly<Record<string, boolean>> = {
  'https://schemastore.azurewebsites.net/': true,
  'https://raw.githubusercontent.com/microsoft/vscode/': true,
  'https://raw.githubusercontent.com/devcontainers/spec/': true,
  'https://www.schemastore.org/': true,
  'https://json.schemastore.org/': true,
  'https://spec.openapis.org/': true,
  'https://json-schema.org/': true,
  'https://developer.microsoft.com/json-schemas/': true,
};
/** `SettingIds.enableSchemaDownload` in jsonClient.ts, and its default in package.json. */
export const schemaDownloadSetting = 'json.schemaDownload.enable';
export const schemaDownloadDefault = true;

/** jsonClientMain.ts `getContent`: a schemastore.org schema that was fetched, or confirmed
 * unchanged, less than `retryTimeoutInHours` ago is answered from disk without a request. */
export const schemastoreAddress = /^https?:\/\/(json|www)\.schemastore\.org\//;
export const schemastoreFreshHours = 2 * 24;

/** urlMatch.ts `isLocalhostAuthority`: a schema served by this computer is always trusted. */
export const localhostAuthorities = [/^(.+\.)?localhost(:\d+)?$/i, /^127\.0\.0\.1(:\d+)?$/, /^\[::1\](:\d+)?$/];

/** `SchemaRequestServiceErrors` in jsonClient.ts: the code VS Code answers a `vscode/content`
 * it refuses or cannot fulfil with. VS Code's own server hands the answer on whole, and the
 * diagnostic gets the code 0x10000 plus this number, which tells a refusal from a failure.
 * The server in vscode-langservers-extracted 4.10.0 hands on the message alone. */
export const schemaContentErrors = { untrustedSchema: 2, httpDisabled: 4, http: 5 } as const;
/** The texts VS Code refuses with (`l10n.t` in the `vscode/content` handler). `{0}` is the
 * name of the setting, and the address in the form it would have been requested in. */
export const schemaRefusals = { disabled: "Downloading schemas is disabled through setting '{0}'", untrusted: 'Location {0} is untrusted' } as const;

/** What the request is answered with when no schema is: the `ResponseError` of the handler. */
export class SchemaContentError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

export type SchemaDownloadSettings = {
  enable: boolean;
  trustedDomains: Record<string, boolean>;
  /** Addresses that are trusted because a schema was assigned to files under them. */
  associated: string[] };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** What the person's settings say about downloading, read the way VS Code reads them. An
 * object setting is laid over its default key by key (`mergeContents`), so a default domain
 * stays trusted until the person sets that same entry to false, and their own entries come
 * after the defaults. A value that is not an object replaces the defaults and trusts nothing.
 * `enable` is taken by its truth, as `!!workspace.getConfiguration().get(...)` takes it.
 *
 * `associated` holds what jsonClient.ts `isTrusted` reads from `json.schemas`: the `url` of
 * each entry, or the `id` of a schema written out in place (`getSchemaId`). VS Code also trusts
 * the addresses extensions assign to files (`jsonValidation`); whoever sends Setdown's own
 * `json/schemaAssociations` adds those addresses to the list. */
export function schemaDownloadSettings(settings: unknown): SchemaDownloadSettings {
  const json = record(record(settings).json), download = record(json.schemaDownload), domains = download.trustedDomains;
  const merged = domains === undefined ? defaultTrustedDomains : domains && typeof domains === 'object' && !Array.isArray(domains) ? { ...defaultTrustedDomains, ...domains } : {};
  const associated = (Array.isArray(json.schemas) ? json.schemas : []).map(entry => record(entry).url || record(record(entry).schema).id)
    .filter((address): address is string => typeof address === 'string' && !!address);
  return { enable: download.enable === undefined ? schemaDownloadDefault : !!download.enable,
    trustedDomains: Object.fromEntries(Object.entries(merged).map(([pattern, trusted]) => [pattern, !!trusted])), associated };
}

type Uri = { scheme: string; authority: string; path: string; query: string; fragment: string };
type Matchable = Pick<Uri, 'scheme' | 'authority' | 'path'>;

/** uri.ts `percentDecode`: a run of escapes is undone as a whole, and one that is not valid
 * UTF-8 stays as written. */
function percentDecode(text: string): string {
  const graceful = (run: string): string => { try { return decodeURIComponent(run); } catch { return run.length > 3 ? run.slice(0, 3) + graceful(run.slice(3)) : run; } };
  return text.replace(/(%[0-9A-Za-z][0-9A-Za-z])+/g, run => graceful(run));
}

/** uri.ts `URI.parse` as the extension calls it, not strict: an address without a scheme is a
 * file, the escapes of each part are undone once, and an http(s) or file path starts with a
 * slash. `_validateUri` refuses the two shapes named below. */
function parseUri(value: string): Uri {
  const match = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/.exec(value) ?? [];
  const scheme = match[2] || 'file', authority = percentDecode(match[4] || '');
  let path = percentDecode(match[5] || '');
  if (['https', 'http', 'file'].includes(scheme) && !path.startsWith('/')) path = `/${path}`;
  if (!/^\w[\w\d+.-]*$/.test(scheme)) throw new Error(`${value} is not an address: a scheme cannot be written "${scheme}"`);
  if (authority ? path && !path.startsWith('/') : path.startsWith('//')) throw new Error(`${value} is not an address: it names no host and its path starts with two slashes`);
  return { scheme, authority, path, query: percentDecode(match[7] || ''), fragment: percentDecode(match[9] || '') };
}

/** uri.ts `_asFormatted` with `skipEncoding`, which is `uri.toString(true)`: the parts are put
 * together as they were read, and only a `#` or `?` inside a part is escaped. The rule that
 * writes a drive letter in lower case is left out; it applies to no http(s) address. */
function format(uri: Uri): string {
  const minimal = (part: string) => part.replace(/[#?]/g, character => character === '#' ? '%23' : '%3F');
  let text = `${uri.scheme}:${uri.authority || uri.scheme === 'file' ? '//' : ''}`, authority = uri.authority;
  const at = authority.indexOf('@');
  if (at !== -1) {
    const userinfo = authority.slice(0, at), colon = userinfo.lastIndexOf(':');
    text += colon === -1 ? `${minimal(userinfo)}@` : `${minimal(userinfo.slice(0, colon))}:${minimal(userinfo.slice(colon + 1))}@`;
    authority = authority.slice(at + 1);
  }
  authority = authority.toLowerCase();
  const port = authority.lastIndexOf(':');
  text += port === -1 ? minimal(authority) : minimal(authority.slice(0, port)) + authority.slice(port);
  return text + minimal(uri.path) + (uri.query ? `?${minimal(uri.query)}` : '') + (uri.fragment ? `#${uri.fragment}` : '');
}

/** urlMatch.ts `getSchemaRequestUrl`: the address a schema is checked under, requested from
 * and cached under. The standard URL reader resolves what the text only suggests (`..`, a
 * backslash, a default port), so the address that is checked is the one that is fetched. */
const requestUrl = (uri: Uri): URL => new URL(format(uri));
const downloaded = (uri: Uri) => uri.scheme === 'http' || uri.scheme === 'https';

/** urlMatch.ts `asMatchableUri`: an http(s) address is compared by the host and path of its
 * requested form, any other address as VS Code read it. */
function matchable(address: Uri | URL): Matchable {
  if (!(address instanceof URL)) { if (!downloaded(address)) return address; address = requestUrl(address); }
  return { scheme: address.protocol.slice(0, -1), authority: address.host, path: address.pathname };
}

/** urlMatch.ts `matchesAuthority`: the same host and port, or `*.` before a domain for the
 * domain itself and everything below it. */
function matchesAuthority(authority: string, pattern: string): boolean {
  authority = authority.toLowerCase(); pattern = pattern.toLowerCase();
  if (pattern === authority) return true;
  return pattern.startsWith('*.') && (authority === pattern.slice(2) || authority.endsWith(`.${pattern.slice(2)}`));
}

/** urlMatch.ts `matchesPath`: no path covers every path, otherwise the path itself and what
 * lies below it. `/schemas` does not cover `/schemas-other`. */
function matchesPath(urlPath: string, pattern: string): boolean {
  if (!pattern || pattern === '/' || urlPath === pattern) return true;
  return urlPath.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`);
}

/** urlMatch.ts `matchesUrlPattern`: whether the trusted domains allow an address. This
 * computer is always allowed. Otherwise the first entry that covers the address decides, with
 * its own true or false, so a narrower entry has to come before a wider one; `*` covers every
 * address. An address no entry covers is not allowed. */
export function matchesUrlPattern(address: string | URL, trustedDomains: Record<string, boolean>): boolean {
  let url: Matchable;
  try { url = matchable(typeof address === 'string' ? parseUri(address) : address); } catch { return false; }
  if (localhostAuthorities.some(local => local.test(url.authority))) return true;
  for (const [pattern, trusted] of Object.entries(trustedDomains)) {
    if (pattern.trim() === '') continue;
    if (pattern === '*') return trusted;
    try {
      const entry = matchable(parseUri(pattern));
      if (url.scheme === entry.scheme && matchesAuthority(url.authority, entry.authority) && matchesPath(url.path, entry.path)) return trusted;
    } catch { /* An entry that is not an address covers nothing. */ }
  }
  return false;
}

/** jsonClient.ts `isTrusted`: the trusted domains allow the address, or it is one a schema
 * association or `json.schemas` names, compared in the form both would be requested in. */
function trusted(url: URL, settings: Pick<SchemaDownloadSettings, 'trustedDomains' | 'associated'>): boolean {
  if (matchesUrlPattern(url, settings.trustedDomains)) return true;
  return settings.associated.some(address => { try { return requestUrl(parseUri(address)).href === url.href; } catch { return false; } });
}

/** Whether a schema at this http(s) address may be downloaded. VS Code asks this of no other
 * kind of address, and neither does Setdown. */
export function isTrustedSchema(uri: string, settings: Pick<SchemaDownloadSettings, 'trustedDomains' | 'associated'>): boolean {
  try { const parsed = parseUri(uri); return downloaded(parsed) && trusted(requestUrl(parsed), settings); } catch { return false; }
}

/** request-light `getErrorStatusDescription`: the sentence for a status of 400 and above. */
const statusTexts: Record<number, string> = {
  400: 'Bad request. The request cannot be fulfilled due to bad syntax.',
  401: 'Unauthorized. The server is refusing to respond.',
  403: 'Forbidden. The server is refusing to respond.',
  404: 'Not Found. The requested location could not be found.',
  405: 'Method not allowed. A request was made using a request method not supported by that location.',
  406: 'Not Acceptable. The server can only generate a response that is not accepted by the client.',
  407: 'Proxy Authentication Required. The client must first authenticate itself with the proxy.',
  408: 'Request Timeout. The server timed out waiting for the request.',
  409: 'Conflict. The request could not be completed because of a conflict in the request.',
  410: 'Gone. The requested page is no longer available.',
  411: 'Length Required. The "Content-Length" is not defined.',
  412: 'Precondition Failed. The precondition given in the request evaluated to false by the server.',
  413: 'Request Entity Too Large. The server will not accept the request, because the request entity is too large.',
  414: 'Request-URI Too Long. The server will not accept the request, because the URL is too long.',
  415: 'Unsupported Media Type. The server will not accept the request, because the media type is not supported.',
  500: 'Internal Server Error.',
  501: 'Not Implemented. The server either does not recognize the request method, or it lacks the ability to fulfill the request.',
  502: 'Bad Gateway. The upstream server did not respond.',
  503: 'Service Unavailable. The server is currently unavailable (overloaded or down).',
};

/** Node's `fetch` says only "fetch failed" and keeps what happened in `cause`. */
function reason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && cause.message ? cause.message : error instanceof Error ? error.message : String(error);
}

/** schemaCache.ts `getCacheFileName`. The name is made from the address alone and has no
 * separator in it, so no address can place a file outside the cache folder. */
const cacheFileName = (address: string) => `${createHash('sha256').update(address).digest('hex')}.schema.json`;
/** schemaCache.ts keeps this list in the extension's `globalState` under `json-schema-cache`;
 * here it is a file beside the schemas. It does not record a file name: one read from disk
 * could point anywhere, and the name follows from the address. */
const cacheList = 'index.json';
type CacheEntry = { etag: string; updateTime: number };
type Answer = { status: number; etag: string | null; text: string };

/** Setdown's own limits. request-light waits as long as the server does and reads whatever
 * arrives; the JSON server is one process for all files and must not be held by one address. */
const requestTimeoutMs = 30_000;
const maxSchemaBytes = 16 * 1024 * 1024;

export type JsonSchemaContentOptions = {
  /** The folder the schemas are kept in. It is made when the first one is stored. */
  directory: string;
  fetch?: typeof fetch;
  /** The time in milliseconds, for the age of a cached schema. */
  now?: () => number;
  /** VS Code names itself and where it runs: `${env.appName} (${env.appHost})`. */
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number };

/** Answers the JSON server's `vscode/content` for an http(s) address: the schema text, or the
 * refusal VS Code gives, which the server shows on the file. */
export class JsonSchemaContent {
  private list: Promise<Map<string, CacheEntry>> | undefined;
  private saved: Promise<void> = Promise.resolve();
  private writes = 0;
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly options: JsonSchemaContentOptions) {}

  /** jsonClient.ts, the `vscode/content` handler, for the two schemes it downloads. The order
   * is the handler's: downloads switched off is said before the address is looked at. */
  async content(uri: string, settings: SchemaDownloadSettings): Promise<string> {
    const parsed = parseUri(uri);
    if (!downloaded(parsed)) throw new Error(`Only an http or https schema is downloaded, and ${uri} is neither`);
    if (!settings.enable) throw new SchemaContentError(schemaContentErrors.httpDisabled, schemaRefusals.disabled.replace('{0}', schemaDownloadSetting));
    // VS Code refuses here in a workspace that is not trusted (`workspace.isTrusted`, "Downloading
    // schemas is disabled in untrusted workspaces"). Setdown has no workspace trust: opening a
    // file is the person's consent, so every file counts as being in a trusted workspace.
    let url: URL;
    try { url = requestUrl(parsed); } catch (error) { throw new SchemaContentError(schemaContentErrors.http, String(error)); }
    if (!trusted(url, settings)) throw new SchemaContentError(schemaContentErrors.untrustedSchema, schemaRefusals.untrusted.replace('{0}', url.href));
    // Files that use one schema ask for it at the same moment; they share one request.
    let pending = this.pending.get(url.href);
    if (!pending) {
      pending = this.get(url.href).finally(() => this.pending.delete(url.href));
      this.pending.set(url.href, pending);
    }
    try { return await pending; }
    catch (error) { throw error instanceof SchemaContentError ? error : new SchemaContentError(schemaContentErrors.http, String(error)); }
  }

  /** jsonClientMain.ts `getContent`. The two days count from `updateTime`, which a download
   * and a "not modified" answer set and an answer from disk does not. */
  private async get(address: string): Promise<string> {
    const entries = await this.entries(), entry = entries.get(address);
    if (entry && schemastoreAddress.test(address) && (this.now() - entry.updateTime) / 1000 / 60 / 60 < schemastoreFreshHours) {
      const content = await this.load(address, entry, false);
      if (content) return content;
    }
    return this.request(address, entries.get(address)?.etag);
  }

  /** jsonClientMain.ts `request`. A schema is kept only when the server names a version of it
   * (`ETag`), and that name is sent with the next request (`If-None-Match`). "Not modified" is
   * answered from disk; when the copy on disk is gone, the schema is asked for once more
   * without the name. A request that fails is not answered from disk: the extension has no
   * such fallback, only the two-day rule above. The failure is worded as the extension words
   * it, the sentence for the status and the first 200 characters the server sent. */
  private async request(address: string, etag?: string): Promise<string> {
    const answer = await this.send(address, { 'User-Agent': this.options.userAgent ?? 'Setdown (desktop)', ...(etag ? { 'If-None-Match': etag } : {}) });
    if (answer.status >= 200 && answer.status < 300) {
      if (answer.etag !== null) await this.put(address, answer.etag, answer.text);
      return answer.text;
    }
    if (answer.status === 304 && etag) return await this.cached(address, etag) || this.request(address);
    // Below 400 request-light has no sentence and the extension prints the response object
    // ("[object Object]"); the number is said here.
    const status = statusTexts[answer.status] ?? `HTTP status code ${answer.status}`;
    throw new SchemaContentError(schemaContentErrors.http, answer.status >= 400 && answer.text ? `${status}\n${answer.text.substring(0, 200)}` : status);
  }

  /** request-light `xhr`, as far as the extension depends on it: a request that could not be
   * made counts as status 404 with "Unable to connect", and a body that could not be read as
   * status 500 with "Unable to access". `fetch` follows redirects itself (up to 20, where the
   * extension lets request-light follow 5) and undoes the compression it asks for. */
  private send(address: string, headers: Record<string, string>): Promise<Answer> {
    const limit = this.options.timeoutMs ?? requestTimeoutMs, signal = AbortSignal.timeout(limit);
    const late = new Promise<never>((_, reject) => signal.addEventListener('abort', () =>
      reject(new SchemaContentError(schemaContentErrors.http, `The schema did not arrive within ${limit / 1000} seconds`)), { once: true }));
    const receive = async (): Promise<Answer> => {
      let response: Response;
      try { response = await (this.options.fetch ?? fetch)(address, { headers, redirect: 'follow', signal }); }
      catch (error) { return { status: 404, etag: null, text: `Unable to connect to ${address}. Error: ${reason(error)}` }; }
      try { return { status: response.status, etag: response.headers.get('etag'), text: await this.text(response) }; }
      catch (error) { if (error instanceof SchemaContentError) throw error; return { status: 500, etag: null, text: `Unable to access ${address}. Error: ${reason(error)}` }; }
    };
    return Promise.race([late, receive()]);
  }

  /** The body as request-light hands it over: UTF-8, a byte order mark left in place for the
   * JSON server to report. A schema above the limit is refused; of an error page the
   * beginning is all that is shown, so the rest is not read. */
  private async text(response: Response): Promise<string> {
    const limit = this.options.maxBytes ?? maxSchemaBytes, chunks: Uint8Array[] = [];
    const large = async () => {
      await response.body?.cancel().catch(() => {});
      if (response.ok) throw new SchemaContentError(schemaContentErrors.http, `The schema is larger than ${limit % (1024 * 1024) ? `${limit} bytes` : `${limit / 1024 / 1024} MiB`}`);
      return Buffer.concat(chunks).toString();
    };
    if (response.ok && Number(response.headers.get('content-length')) > limit) return large();
    const reader = response.body?.getReader();
    for (let size = 0; reader;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.byteLength) > limit) { reader.releaseLock(); return large(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString();
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
  private file(name: string): string { return path.join(this.options.directory, name); }

  /** schemaCache.ts, the constructor: an entry that is not an `etag` and a time is dropped.
   * A list that is missing or cannot be read is an empty one. */
  private entries(): Promise<Map<string, CacheEntry>> {
    return this.list ??= readFile(this.file(cacheList), 'utf8').then(text => {
      const valid = new Map<string, CacheEntry>();
      for (const [address, entry] of Object.entries(record(JSON.parse(text)))) {
        const { etag, updateTime } = record(entry);
        if (typeof etag === 'string' && typeof updateTime === 'number') valid.set(address, { etag, updateTime });
      }
      return valid;
    }).catch(() => new Map<string, CacheEntry>());
  }

  /** A file appears under its name whole or not at all, so a schema that was cut short by a
   * crash is never the one answered for two days. */
  private async write(name: string, content: string): Promise<void> {
    const partial = this.file(`${name}.${process.pid}.${++this.writes}.tmp`);
    await mkdir(this.options.directory, { recursive: true });
    try { await writeFile(partial, content); await rename(partial, this.file(name)); }
    catch (error) { await rm(partial, { force: true }).catch(() => {}); throw error; }
  }

  /** schemaCache.ts `updateMemento`. One write at a time, each of the list as it then is. A
   * list that cannot be written costs a download later and nothing now. */
  private save(): Promise<void> {
    return this.saved = this.saved.then(async () => {
      try { await this.write(cacheList, JSON.stringify(Object.fromEntries(await this.entries()))); } catch { /* The folder cannot be written to. */ }
    });
  }

  /** schemaCache.ts `putSchema`: a schema that could not be stored is not listed. */
  private async put(address: string, etag: string, content: string): Promise<void> {
    const entries = await this.entries();
    try { await this.write(cacheFileName(address), content); entries.set(address, { etag, updateTime: this.now() }); }
    catch { entries.delete(address); }
    await this.save();
  }

  /** schemaCache.ts `loadSchemaFile`: a listed schema whose file cannot be read is forgotten. */
  private async load(address: string, entry: CacheEntry, confirmed: boolean): Promise<string | undefined> {
    try {
      const content = await readFile(this.file(cacheFileName(address)), 'utf8');
      if (confirmed) { entry.updateTime = this.now(); await this.save(); }
      return content;
    } catch {
      (await this.entries()).delete(address);
      await this.save();
      return undefined;
    }
  }

  /** schemaCache.ts `getSchema` after "not modified": the copy on disk when it is the version
   * the server confirmed, and a copy of another version is deleted (`deleteSchemaFile`). */
  private async cached(address: string, etag: string): Promise<string | undefined> {
    const entries = await this.entries(), entry = entries.get(address);
    if (!entry) return undefined;
    if (entry.etag === etag) return this.load(address, entry, true);
    entries.delete(address);
    await this.save();
    await rm(this.file(cacheFileName(address)), { force: true }).catch(() => {});
    return undefined;
  }
}
