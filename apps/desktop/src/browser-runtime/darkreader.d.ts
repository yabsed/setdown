declare module '@setdown/darkreader' {
  export function enable(theme: Record<string, unknown>, fixes: unknown): void;
  export function disable(): void;
  export function setFetchMethod(fetch: (url: string) => Promise<Response>): void;
}
declare module '@setdown/darkreader-fixes' { export function siteFix(url: string): unknown; }
declare module '@setdown/darkreader-proxy' { export function injectProxy(styles: boolean, customElements: boolean): void; }
