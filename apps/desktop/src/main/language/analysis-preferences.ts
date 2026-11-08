import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import type { AnalysisEnvironmentKind, PythonChecking } from '../../core/document/analysis-context';

type Preferences = Partial<Record<AnalysisEnvironmentKind, string>> & { 'python-checking'?: PythonChecking };
function valid(kind: string, value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && value.length <= 4096
    && (kind === 'python-checking' ? ['off', 'basic', 'standard', 'strict'].includes(value)
      : ['python', 'typescript', 'compilation'].includes(kind) && (path.isAbsolute(value) || kind === 'typescript' && value === 'bundled'));
}
/** Shared by ordinary files and notebooks. Legacy notebook overrides remain separate. */
export class AnalysisPreferences {
  constructor(private readonly directory: () => string = () => app.getPath('userData')) {}
  private get file() { return path.join(this.directory(), 'project-analysis.json'); }
  private read(): Record<string, Preferences> {
    if (!existsSync(this.file)) return {};
    if (statSync(this.file).size > 1024 * 1024) throw Error('Project analysis preferences are too large.');
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    if (data.version !== 1 || !data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) throw Error('Invalid project analysis preferences.');
    for (const [root, choices] of Object.entries(data.projects)) {
      if (!path.isAbsolute(root) || !choices || typeof choices !== 'object' || Array.isArray(choices)) throw Error('Invalid project analysis scope.');
      for (const [kind, value] of Object.entries(choices)) if (!valid(kind, value)) throw Error('Invalid analysis environment selection.');
    }
    return data.projects;
  }
  get(root: string): Preferences { return this.read()[path.resolve(root)] ?? {}; }
  pythonFor(file: string): string | undefined {
    const projects = this.read();
    return Object.keys(projects).filter(root => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); })
      .sort((a, b) => b.length - a.length).map(root => projects[root].python).find(Boolean);
  }
  set(root: string, kind: AnalysisEnvironmentKind | 'python-checking', value?: string): void {
    if (!path.isAbsolute(root) || !['python', 'typescript', 'compilation', 'python-checking'].includes(kind) || value !== undefined && !valid(kind, value)) throw Error('Invalid analysis selection.');
    const projects = this.read(), key = path.resolve(root), choices = { ...projects[key] };
    if (value === undefined) delete choices[kind]; else if (kind === 'python-checking') choices[kind] = value as PythonChecking; else choices[kind] = value;
    if (Object.keys(choices).length) projects[key] = choices; else delete projects[key];
    const text = JSON.stringify({ version: 1, projects }, null, 2) + '\n';
    if (text.length > 1024 * 1024) throw Error('Too many project analysis preferences.');
    mkdirSync(this.directory(), { recursive: true }); writeFileSync(this.file + '.tmp', text); renameSync(this.file + '.tmp', this.file);
  }
}
export const analysisPreferences = new AnalysisPreferences();
