import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, isInside } from './file-system';
import { rewriteAssetReferences, type AssetRelocation } from '../../core/markdown/asset-references';

function assetDirectoryFor(documentPath: string) {
  const extension = path.extname(documentPath);
  const stem = path.basename(documentPath, extension);
  return path.join(path.dirname(documentPath), `${stem}.assets`);
}

async function exists(candidate: string) {
  return fs.access(candidate).then(() => true, () => false);
}

async function unusedAssetDirectory(destinationDocumentPath: string) {
  const preferred = assetDirectoryFor(destinationDocumentPath);
  if (!(await exists(preferred))) return preferred;
  const directory = path.dirname(preferred);
  const base = path.basename(preferred);
  for (let sequence = 2; ; sequence += 1) {
    const candidate = path.join(directory, `${base}-${sequence}`);
    if (!(await exists(candidate))) return candidate;
  }
}

export function rewriteDraftAssetReferences(
  text: string,
  sourceDirectoryName: string,
  destinationDirectoryName: string,
) {
  return rewriteAssetReferences(text, { sourceDirectoryName, destinationDirectoryName });
}

export function isDraftDocumentPath(draftsRoot: string, documentPath: string) {
  const relative = path.relative(path.resolve(draftsRoot), path.resolve(documentPath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function saveDraftBundle(
  draftsRoot: string,
  sourceDocumentPath: string,
  destinationDocumentPath: string,
  text: string,
) {
  if (!isDraftDocumentPath(draftsRoot, sourceDocumentPath)) {
    throw new Error('The temporary document is outside the Setdown drafts directory.');
  }
  const sourceRoot = path.dirname(sourceDocumentPath);
  if (isInside(sourceRoot, path.resolve(destinationDocumentPath))) throw new Error('Choose a destination outside this temporary draft folder.');
  const sourceAssets = assetDirectoryFor(sourceDocumentPath);
  const hasAssets = await exists(sourceAssets);
  await fs.mkdir(path.dirname(destinationDocumentPath), { recursive: true });

  let savedText = text;
  let committedAssets: string | null = null;
  let assetRelocation: AssetRelocation | undefined;
  if (hasAssets) {
    committedAssets = await unusedAssetDirectory(destinationDocumentPath);
    const staging = path.join(
      path.dirname(committedAssets),
      `.${path.basename(committedAssets)}.${randomUUID()}.tmp`,
    );
    try {
      await fs.cp(sourceAssets, staging, { recursive: true, errorOnExist: true });
      await fs.rename(staging, committedAssets);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    assetRelocation = { sourceDirectoryName: path.basename(sourceAssets), destinationDirectoryName: path.basename(committedAssets) };
    savedText = rewriteAssetReferences(text, assetRelocation);
  }

  let diskVersion;
  try {
    diskVersion = await atomicWrite(destinationDocumentPath, savedText);
  } catch (error) {
    if (committedAssets) {
      await fs.rm(committedAssets, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
  // 목적지 commit 이후의 draft 청소 실패가 성공한 저장을 실패로 뒤집으면 안 된다.
  await fs.rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
  return { text: savedText, assetDirectory: committedAssets, assetRelocation, diskVersion };
}

export async function discardDraftBundle(draftsRoot: string, documentPath: string) {
  if (!isDraftDocumentPath(draftsRoot, documentPath)) return false;
  await fs.rm(path.dirname(documentPath), { recursive: true, force: true });
  return true;
}
