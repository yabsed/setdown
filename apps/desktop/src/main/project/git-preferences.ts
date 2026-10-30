import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { gitSettings, type GitSettings } from '../../core/project/git-settings';

type Preferences = { settings?: Partial<GitSettings>; hidden?: string[]; parent?: string };
export class GitPreferences {
  private values: Record<string, Preferences> = {};
  private loaded?: Promise<void>;
  private saving = Promise.resolve();
  constructor(private readonly file: () => string | null = () => null) {}
  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      const file = this.file();
      if (!file) return;
      const data = await fs.readFile(file, 'utf8').catch(() => '{}');
      try { const parsed = JSON.parse(data); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed; } catch { /* Defaults until the user changes a setting. */ }
    })();
  }
  async get(root: string) {
    await this.load();
    const text = await fs.readFile(path.join(root, '.vscode', 'settings.json'), 'utf8').catch(() => '{}');
    const workspace = parse(text) ?? {};
    const saved = this.values[root] ?? {};
    return { settings: gitSettings({ ...gitSettings(workspace), ...saved.settings }), overrides: saved.settings ?? {},
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(value => typeof value === 'string') : [], parent: saved.parent };
  }
  async set(root: string, update: Preferences): Promise<void> {
    await this.load(); this.values[root] = { ...this.values[root], ...update };
    const file = this.file();
    if (!file) return;
    const text = JSON.stringify(this.values, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, text); await fs.rename(`${file}.tmp`, file);
    });
    await this.saving;
  }
}
