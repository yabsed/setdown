import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

async function atomicWrite(filePath: string, text: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(temporary, text, { encoding: 'utf8', mode: stat?.mode });
  await fs.rename(temporary, filePath);
}

export function rewriteDraftAssetReferences(
  text: string,
  sourceDirectoryName: string,
  destinationDirectoryName: string,
) {
  if (sourceDirectoryName === destinationDirectoryName) return text;
  return text.split(`${sourceDirectoryName}/`).join(`${destinationDirectoryName}/`);
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
    throw new Error('임시 문서가 Setdown draft 디렉터리 밖에 있습니다.');
  }
  const sourceRoot = path.dirname(sourceDocumentPath);
  const sourceAssets = assetDirectoryFor(sourceDocumentPath);
  const hasAssets = await exists(sourceAssets);
  await fs.mkdir(path.dirname(destinationDocumentPath), { recursive: true });

  let savedText = text;
  let committedAssets: string | null = null;
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
    savedText = rewriteDraftAssetReferences(
      text,
      path.basename(sourceAssets),
      path.basename(committedAssets),
    );
  }

  try {
    await atomicWrite(destinationDocumentPath, savedText);
  } catch (error) {
    if (committedAssets) {
      await fs.rm(committedAssets, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
  // 목적지 commit 이후의 draft 청소 실패가 성공한 저장을 실패로 뒤집으면 안 된다.
  await fs.rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
  return { text: savedText, assetDirectory: committedAssets };
}

export async function discardDraftBundle(draftsRoot: string, documentPath: string) {
  if (!isDraftDocumentPath(draftsRoot, documentPath)) return false;
  await fs.rm(path.dirname(documentPath), { recursive: true, force: true });
  return true;
}
