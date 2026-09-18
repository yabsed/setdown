import { previewThemeBackground } from '../core/preview/preview-preferences';
import { GOLDEN_TOP_RATIO } from '../core/preview/viewport-anchor';
import type { SourceAtlas } from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  revision: () => number;
  send: (message: Record<string, unknown>) => void;
  viewportChanged: () => void;
};

const DARK_THEMES = new Set(['github-dark', 'night', 'one-dark', 'solarized-dark']);

export class ThemeController {
  private application = 0;

  constructor(private readonly options: Options) {}

  initialize(themeId: string): void {
    this.paintBackground(themeId);
    this.publishTheme(themeId);
  }

  async apply(themeId: string, previewCssUrl: unknown, codeCssUrl: unknown): Promise<void> {
    if (!this.isLocalAsset(previewCssUrl) || !this.isLocalAsset(codeCssUrl)) return;
    const application = ++this.application;
    this.paintBackground(themeId);
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
    const maximumScrollTop = Math.max(
      0,
      (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
    );
    const boundary = scrollTop <= 1
      ? 'start'
      : maximumScrollTop > 0 && maximumScrollTop - scrollTop <= 1
        ? 'end'
        : null;
    const anchor = this.options.sourceAtlas.viewportAnchorAt(GOLDEN_TOP_RATIO);
    await Promise.all([
      this.replaceStylesheet('/styles/preview_theme/', previewCssUrl),
      this.replaceStylesheet('/styles/prism_theme/', codeCssUrl),
    ]);
    if (application !== this.application) return;

    const restore = () => {
      if (boundary === 'start') {
        document.documentElement.scrollTop = document.body.scrollTop = 0;
      } else if (boundary === 'end') {
        const maximum = Math.max(
          0,
          (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
        );
        document.documentElement.scrollTop = document.body.scrollTop = maximum;
      } else {
        this.options.sourceAtlas.position(anchor.sourceLine, anchor.yRatio);
      }
    };
    const finish = () => {
      this.publishTheme(themeId);
      document.body.dataset.setdownThemeAnchorLine = String(anchor.sourceLine);
      this.options.sourceAtlas.invalidate();
      this.options.viewportChanged();
      this.options.send({
        type: 'marktex:theme-applied',
        revision: this.options.revision(),
        themeId,
      });
    };

    this.options.sourceAtlas.invalidate();
    if (document.visibilityState === 'hidden') {
      restore();
      finish();
      return;
    }
    await this.nextFrame(restore);
    await this.nextFrame(restore);
    finish();
  }

  private paintBackground(themeId: string): void {
    const background = previewThemeBackground(themeId);
    document.documentElement.style.setProperty('background-color', background, 'important');
    document.body.style.setProperty('background-color', background, 'important');
  }

  private publishTheme(themeId: string): void {
    document.body.dataset.setdownPreviewTheme = themeId;
    document.body.dataset.previewTheme = DARK_THEMES.has(themeId) ? 'dark' : 'light';
  }

  private isLocalAsset(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
      return new URL(value).protocol === 'marktex-resource:';
    } catch {
      return false;
    }
  }

  private stylesheet(pathFragment: string): HTMLLinkElement | null {
    return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .find((link) => {
        try {
          return decodeURIComponent(link.href).includes(pathFragment);
        } catch {
          return link.href.includes(pathFragment);
        }
      }) ?? null;
  }

  private replaceStylesheet(pathFragment: string, url: string): Promise<void> {
    const existing = this.stylesheet(pathFragment);
    if (existing) {
      if (existing.href === url) return Promise.resolve();
      return this.waitForStylesheet(existing, () => existing.href = url);
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    return this.waitForStylesheet(link, () => document.head.append(link));
  }

  private waitForStylesheet(link: HTMLLinkElement, start: () => void): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => resolve();
      link.addEventListener('load', finish, { once: true });
      link.addEventListener('error', finish, { once: true });
      start();
      window.setTimeout(finish, 1_000);
    });
  }

  private nextFrame(action: () => void): Promise<void> {
    return new Promise((resolve) => window.requestAnimationFrame(() => {
      action();
      resolve();
    }));
  }
}
