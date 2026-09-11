import { promises as fs } from 'node:fs';
import path from 'node:path';

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

export async function savePastedPng(
  documentPath: string,
  png: Uint8Array,
  now = new Date(),
): Promise<SavedPastedImage> {
  const documentDirectory = path.dirname(documentPath);
  const extension = path.extname(documentPath);
  const documentStem = path.basename(documentPath, extension);
  const assetDirectoryName = `${documentStem}.assets`;
  const assetDirectory = path.join(documentDirectory, assetDirectoryName);
  const timestamp = timestampForFile(now);

  await fs.mkdir(assetDirectory, { recursive: true });

  for (let sequence = 0; ; sequence += 1) {
    const suffix = sequence === 0 ? '' : `-${sequence + 1}`;
    const filename = `pasted-${timestamp}${suffix}.png`;
    const absolutePath = path.join(assetDirectory, filename);
    try {
      await fs.writeFile(absolutePath, png, { flag: 'wx' });
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
