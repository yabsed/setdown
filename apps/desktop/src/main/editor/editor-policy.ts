import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EditorPolicy, EditorSetting } from '../../protocol/editor-tools';
/** EditorConfig's declarative subset; unsupported settings remain visible. */
export async function readEditorPolicy(file: string, projectRoot?: string | null): Promise<EditorPolicy> {
  const files: Array<{ path: string; text: string }> = [], warnings: string[] = [];
  let directory = path.dirname(file);
  const boundary = projectRoot && (file === projectRoot || file.startsWith(projectRoot + path.sep)) ? projectRoot : path.parse(file).root;
  for (let depth = 0; depth < 64; depth++) {
    const config = path.join(directory, '.editorconfig');
    try {
      const stat = await fs.stat(config); if (stat.size > 256 * 1024) throw Error('exceeds 256 KiB');
      const text = await fs.readFile(config, 'utf8'); files.unshift({ path: config, text });
      if (/^\s*root\s*=\s*true\s*$/im.test(text.split(/^\s*\[/m)[0])) break;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${config}: ${String(error)}`); }
    const parent = path.dirname(directory); if (directory === boundary || parent === directory) break; directory = parent;
  }
  const effective = new Map<string, EditorSetting>();
  for (const config of files) {
    const relative = path.relative(path.dirname(config.path), file).split(path.sep).join('/'); let matches = false;
    for (const line of config.text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const section = /^\s*\[(.+)\]\s*$/.exec(line);
      if (section) { try { matches = glob(section[1], relative); } catch (error) { matches = false; warnings.push(`${config.path}: ${String(error)}`); } continue; }
      if (!matches || /^\s*[#;]/.test(line)) continue;
      const pair = /^\s*([\w]+)\s*=\s*(.*?)\s*$/.exec(line); if (!pair) continue;
      const key = pair[1].toLowerCase(), value = pair[2].toLowerCase();
      if (value === 'unset') { effective.delete(key); continue; }
      effective.set(key, { key, value, source: config.path, supported: false });
    }
  }
  const policy: EditorPolicy = { settings: [...effective.values()], warnings };
  const indent = effective.get('indent_style'); if (indent && ['space', 'tab'].includes(indent.value)) { indent.supported = true; policy.insertSpaces = indent.value === 'space'; }
  const size = effective.get('indent_size'), tab = effective.get('tab_width');
  const width = (value?: string) => value && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 16 ? Number(value) : undefined;
  policy.tabSize = width(tab?.value) ?? width(size?.value);
  policy.indentSize = size?.value === 'tab' ? policy.tabSize : width(size?.value) ?? width(tab?.value);
  if (size && (width(size.value) !== undefined || size.value === 'tab')) size.supported = true;
  if (tab && width(tab.value) !== undefined) tab.supported = true;
  const eol = effective.get('end_of_line'); if (eol && ['lf', 'crlf'].includes(eol.value)) policy.eol = eol.value === 'lf' ? '\n' : '\r\n';
  // Encoding conversion and save-time whitespace edits are explicit commands.
  for (const setting of policy.settings) if (!setting.supported) warnings.push(`${setting.key}=${setting.value} is reported only; it does not rewrite this file.`);
  return policy;
}
export function glob(pattern: string, relative: string): boolean {
  if (pattern.length > 1024) throw Error('EditorConfig pattern is too long.');
  let source = '', i = 0;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  while (i < pattern.length) {
    const char = pattern[i++];
    if (char === '*') { if (pattern[i] === '*') { i++; if (pattern[i] === '/') { i++; source += '(?:.*/)?'; } else source += '.*'; } else source += '[^/]*'; }
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      const end = pattern.indexOf('}', i); if (end < 0) throw Error('Unclosed EditorConfig alternatives.');
      const body = pattern.slice(i, end), range = /^(-?\d+)\.\.(-?\d+)$/.exec(body);
      let values = body.split(',');
      if (range) { const a = Number(range[1]), b = Number(range[2]); if (Math.abs(b - a) > 200) throw Error('EditorConfig numeric range is too large.'); values = Array.from({ length: Math.abs(b - a) + 1 }, (_, n) => String(a + n * (a <= b ? 1 : -1))); }
      source += `(?:${values.map(escape).join('|')})`; i = end + 1;
    } else if (char === '[') {
      const end = pattern.indexOf(']', i); if (end < 0) throw Error('Unclosed EditorConfig character class.');
      const body = pattern.slice(i, end); if (!/^[!\w-]+$/.test(body)) throw Error('Unsupported EditorConfig character class.');
      source += `[${body.replace(/^!/, '^')}]`; i = end + 1;
    } else if (char === '\\' && i < pattern.length) source += escape(pattern[i++]); else source += escape(char);
  }
  return new RegExp(`^${source.replace(/^\//, '')}$`).test(pattern.includes('/') ? relative : relative.split('/').at(-1)!);
}
