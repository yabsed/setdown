import { app } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PREVIEW_THEME,
  codeThemeFile,
  normalizePreviewTheme,
  previewThemeBackground,
  previewThemeFile,
  type PreviewThemeAssets,
  type PreviewThemeId,
} from '../../core/preview/preview-preferences';
import { themeProfile } from '../../core/theme/theme-catalog';
import type { ThemeSnapshot } from '../../core/theme/theme-state';
import { resourceUrl } from '../preview/resource-url';
import type { WindowState } from '../windows/window-state';

type Options = {
  crossnoteRoot: string;
  windows: () => Iterable<WindowState>;
  updatePreviews: (theme: PreviewThemeId) => void;
};

export class ThemeManager {
  id: PreviewThemeId = DEFAULT_PREVIEW_THEME;
  revision = 0;

  constructor(private readonly options: Options) {}

  get snapshot(): ThemeSnapshot {
    return { id: this.id, revision: this.revision };
  }

  load(): void {
    try {
      const stored = JSON.parse(readFileSync(this.settingsPath(), 'utf8')) as {
        previewTheme?: unknown;
      };
      this.id = normalizePreviewTheme(stored.previewTheme);
    } catch {
      this.id = DEFAULT_PREVIEW_THEME;
    }
  }

  set(value: unknown): void {
    this.id = normalizePreviewTheme(value);
    this.revision += 1;
    this.save();
    this.options.updatePreviews(this.id);
    for (const state of this.options.windows()) {
      const profile = themeProfile(this.id);
      state.window.setTitleBarOverlay({
        color: profile.palette.chrome,
        symbolColor: profile.palette.text,
        height: Math.round(36 * state.window.webContents.getZoomFactor()),
      });
      state.window.webContents.send('theme:changed', this.snapshot);
    }
  }

  assets(value: unknown): PreviewThemeAssets {
    const themeId = normalizePreviewTheme(value);
    return {
      themeId,
      backgroundColor: previewThemeBackground(themeId),
      previewCssUrl: resourceUrl(path.resolve(
        this.options.crossnoteRoot,
        'styles',
        'preview_theme',
        previewThemeFile(themeId),
      )),
      codeCssUrl: resourceUrl(path.resolve(
        this.options.crossnoteRoot,
        'styles',
        'prism_theme',
        codeThemeFile(themeId),
      )),
    };
  }

  private settingsPath(): string {
    return path.join(app.getPath('userData'), 'reader-settings.json');
  }

  private save(): void {
    const settingsPath = this.settingsPath();
    void fs.mkdir(path.dirname(settingsPath), { recursive: true })
      .then(() => fs.writeFile(settingsPath, JSON.stringify({
        previewTheme: this.id,
      }, null, 2), 'utf8'))
      .catch((error) => console.error('Failed to save reader settings:', error));
  }
}
