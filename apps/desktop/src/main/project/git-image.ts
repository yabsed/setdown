import { promises as fs } from 'node:fs';
import { imageMimeType } from '../../core/document/document-profile';
import type { GitImageVersion } from '../../protocol/desktop-api';
import { MAX_IMAGE_BYTES, readImageBytes, readImageMetadata } from '../documents/image-file';
import type { GitCli } from './engines/git-cli';

/** Read immutable Git blobs; never substitute the current working file. */
export async function readGitImage(repository: GitCli, specification: string | undefined, filePath: string): Promise<GitImageVersion> {
  if (!specification) return null;
  try {
    if (!(await repository.objectExists(specification))) return null;
    const size = Number((await repository.run(['cat-file', '-s', specification])).trim());
    if (!Number.isSafeInteger(size) || size < 0) throw Error('Could not read the image size.');
    if (size > MAX_IMAGE_BYTES) throw Error('Images must be 64 MiB or smaller.');
    const bytes = await repository.runBytes(['show', specification], 10_000, MAX_IMAGE_BYTES);
    if (bytes.length > MAX_IMAGE_BYTES) throw Error('Images must be 64 MiB or smaller.');
    return { bytes, mimeType: imageMimeType(filePath)! };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export async function readWorkingImage(filePath: string): Promise<GitImageVersion> {
  try {
    if ((await fs.lstat(filePath)).isSymbolicLink()) throw Error('Symbolic links cannot be previewed as images.');
    const { diskVersion } = await readImageMetadata(filePath);
    return { bytes: await readImageBytes(filePath, diskVersion), mimeType: imageMimeType(filePath)! };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
