/** Serializable page state. Live WebContents and profile data remain in main. */
export type BrowserPage = {
  id: string;
  url: string;
  title: string;
  startPage: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  audible: boolean;
  muted: boolean;
  error: string | null;
  protection: 'starting' | 'ready' | 'error';
};
