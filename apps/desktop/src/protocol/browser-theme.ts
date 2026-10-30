import type { ThemeId } from '../core/theme/theme-catalog';
export type BrowserThemeSettings = { mode: 'app' | 'original'; originalSites: string[] };
export type BrowserThemeUpdate = { mode?: 'app' | 'original'; site?: { tabId: string; original: boolean }; restoreSite?: string };
export type BrowserThemePolicy = { token: number; theme: ThemeId | null; url: string };
