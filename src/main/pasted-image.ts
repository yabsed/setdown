import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp',
]);

export type SavedPastedImage = {
  absolutePath: string;
  markdownPath: string;
  markdown: string;
};

function timestampForFile(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function markdownPath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

export function isSupportedImagePath(filePath: string) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function savePastedAsset(
  documentPath: string,
  extension: string,
  write: (destination: string) => Promise<void>,
  now: Date,
): Promise<SavedPastedImage> {
  const documentDirectory = path.dirname(documentPath);
  const documentExtension = path.extname(documentPath);
  const documentStem = path.basename(documentPath, documentExtension);
  const assetDirectoryName = `${documentStem}.assets`;
  const assetDirectory = path.join(documentDirectory, assetDirectoryName);
  const timestamp = timestampForFile(now);

  await fs.mkdir(assetDirectory, { recursive: true });

  for (let sequence = 0; ; sequence += 1) {
    const suffix = sequence === 0 ? '' : `-${sequence + 1}`;
    const filename = `pasted-${timestamp}${suffix}${extension}`;
    const absolutePath = path.join(assetDirectory, filename);
    try {
      await write(absolutePath);
      const relativePath = markdownPath(path.join(assetDirectoryName, filename));
      return {
        absolutePath,
        markdownPath: relativePath,
        // angle destination은 공백을 보존하면서 Markdown parser가 실제 파일
        // 경로를 URL 인코딩된 별도 파일명으로 오해하지 않게 한다.
        markdown: `![붙여넣은 이미지](<${relativePath}>)`,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export async function savePastedPng(
  documentPath: string,
  png: Uint8Array,
  now = new Date(),
): Promise<SavedPastedImage> {
  return savePastedAsset(
    documentPath,
    '.png',
    (destination) => fs.writeFile(destination, png, { flag: 'wx' }),
    now,
  );
}

export async function savePastedImageFile(
  documentPath: string,
  sourcePath: string,
  now = new Date(),
): Promise<SavedPastedImage> {
  if (!isSupportedImagePath(sourcePath)) {
    throw new Error('지원하지 않는 이미지 파일 형식입니다.');
  }
  const sourceStats = await fs.stat(sourcePath);
  if (!sourceStats.isFile()) throw new Error('붙여넣을 이미지가 파일이 아닙니다.');
  const extension = path.extname(sourcePath).toLowerCase();
  return savePastedAsset(
    documentPath,
    extension,
    (destination) => fs.copyFile(sourcePath, destination, fsConstants.COPYFILE_EXCL),
    now,
  );
}
