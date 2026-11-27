// Programs of this computer that a language tool was found in and that cannot run.
//
// A tool is looked for on this computer before Setdown downloads it: Zed's adapters do so
// (`LspAdapter::check_if_user_installed`), and so does the Kotlin extension since 0.3.5
// (zed-extensions/kotlin src/language_servers/kotlin_lsp.rs `worktree.which("kotlin-lsp")`).
// That is right while the program works. A program that ends by itself saying its build has
// expired, or one that is no language tool, fails the same way at every start, and the person
// is left without the language although Setdown could download a copy that runs. Such a program
// is set aside here: the next start of the tool passes it by and uses Setdown's own copy, and
// the person is told which program was passed by and why.
//
// What is never set aside: a program the person named in Language Support. That one is used as
// it is and its failure is shown.
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type SetAside = {
  /** The tool's own sentence, or what Setdown saw. */
  detail?: string;
  at: number;
  /** The file as it was: a program that was replaced since is given another start. */
  size: number; mtime: number;
  /** Kept across restarts of the app. Only what cannot mend itself is: a build that has expired. */
  lasting: boolean;
};
/** A lasting entry is tried once more after this long: the file a launcher starts can be replaced without the launcher changing. */
export const setAsideFor = 24 * 60 * 60 * 1000;

/** The first program of this name on PATH, as Zed's `which_in(command, PATH, root)` finds it. */
export async function programOnPath(command: string, env: NodeJS.ProcessEnv, root?: string, skip: readonly string[] = []): Promise<string | undefined> {
  const folders = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' && !path.extname(command)
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(extension => command + extension.toLowerCase()) : [command];
  for (const folder of folders) for (const name of names) {
    const candidate = path.resolve(root ?? process.cwd(), folder, name);
    if (skip.includes(candidate)) continue;
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* The next folder of PATH. */ }
  }
  return undefined;
}

export class SetAsidePrograms {
  private entries: Map<string, SetAside> | undefined;
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  private async load(): Promise<Map<string, SetAside>> {
    if (this.entries) return this.entries;
    const entries = new Map<string, SetAside>();
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as { version?: number; programs?: Record<string, SetAside> };
      if (saved.version === 1) for (const [program, entry] of Object.entries(saved.programs ?? {}))
        if (path.isAbsolute(program) && Number.isFinite(entry?.size) && Number.isFinite(entry?.mtime) && Number.isFinite(entry?.at))
          entries.set(program, { ...(typeof entry.detail === 'string' ? { detail: entry.detail.slice(0, 400) } : {}), at: entry.at, size: entry.size, mtime: entry.mtime, lasting: true });
    } catch { /* Nothing was set aside, or the file is not readable: every program is tried. */ }
    return this.entries ??= entries;
  }
  private save(entries: Map<string, SetAside>): Promise<void> {
    const lasting = Object.fromEntries([...entries].filter(([, entry]) => entry.lasting).map(([program, { detail, at, size, mtime }]) => [program, { detail, at, size, mtime }]));
    return this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const staging = `${this.file}.${randomUUID()}`;
      await writeFile(staging, JSON.stringify({ version: 1, programs: lasting }), { mode: 0o600 });
      await rename(staging, this.file);
    }).catch(error => console.warn('The programs set aside could not be written', error));
  }
  /** The file a name on PATH stands for: a link is followed, so replacing what it points at is seen. */
  private async signature(program: string): Promise<{ size: number; mtime: number } | undefined> {
    try { const info = await stat(await realpath(program)); return info.isFile() ? { size: info.size, mtime: info.mtimeMs } : undefined; }
    catch { return undefined; }
  }
  /** Why this program is passed by, or nothing when it is to be started. */
  async find(program: string): Promise<SetAside | undefined> {
    const entries = await this.load(), entry = entries.get(program);
    if (!entry) return undefined;
    const current = await this.signature(program);
    if (current && current.size === entry.size && current.mtime === entry.mtime && this.now() - entry.at < setAsideFor) return entry;
    // Replaced, removed, or long ago: it is tried again.
    entries.delete(program);
    if (entry.lasting) await this.save(entries);
    return undefined;
  }
  /** Sets a program aside. False when it already was, or is no file: nothing changed, so starting the tool again would end the same way. */
  async add(program: string, reason: { detail?: string; lasting: boolean }): Promise<boolean> {
    if (!path.isAbsolute(program) || await this.find(program)) return false;
    const current = await this.signature(program);
    if (!current) return false;
    const entries = await this.load();
    entries.set(program, { ...(reason.detail ? { detail: reason.detail.slice(0, 400) } : {}), at: this.now(), ...current, lasting: reason.lasting });
    if (reason.lasting) await this.save(entries);
    return true;
  }
  /** The person asked for another try: every program, or the named ones, is started again. */
  async clear(programs?: readonly string[]): Promise<void> {
    const entries = await this.load();
    const lasting = [...entries].some(([program, entry]) => entry.lasting && (!programs || programs.includes(program)));
    if (programs) for (const program of programs) entries.delete(program); else entries.clear();
    if (lasting) await this.save(entries);
  }
  async programs(): Promise<string[]> { return [...(await this.load()).keys()]; }
}

/** One line for the person: which program was passed by, and the reason in the tool's own words. */
export const setAsideNote = (name: string, program: string, detail?: string): string =>
  `${name} was found on this computer at ${program}, and that program does not run${detail ? `: ${detail.replace(/[.\s]+$/, '')}` : ''}. Setdown is using its own copy. Restart ${name} to try that program again.`;
