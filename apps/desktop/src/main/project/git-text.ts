import { promises as fs } from 'node:fs';
import { isMarkdownDocument, isTextCandidate } from '../../core/document/document-profile';
import { decodeTextBytes } from '../../core/document/text-codec';
import { readTextFile } from '../documents/text-file';
import type { GitCli } from './engines/git-cli';

/** null means unsupported/unreadable; empty text is reserved for a missing version. */
export async function readGitDocument(repository: GitCli, specification: string, filePath: string): Promise<string | null> {
  if (isMarkdownDocument(filePath)) {
    try { const text = await repository.run(['show', specification]); return text.includes('\0') ? null : text; }
    catch { return ''; }
  }
  if (!isTextCandidate(filePath)) return null;
  try { await repository.run(['cat-file', '-e', specification]); } catch { return ''; }
  try { return decodeTextBytes(await repository.runBytes(['show', specification])).text; } catch { return null; }
}

export async function readWorkingDocument(filePath: string): Promise<string | null> {
  if (isMarkdownDocument(filePath)) {
    const bytes = await fs.readFile(filePath).catch(() => null);
    return !bytes ? '' : bytes.includes(0) ? null : bytes.toString('utf8');
  }
  try { return (await readTextFile(filePath)).text; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null; }
}
