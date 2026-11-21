import { expect, it, vi } from 'vitest';
import { FilePreviews } from './file-previews';

const model = (text: string) => ({ text, dispose: vi.fn() });
it('a file is read once for everyone who looks at it now, and its model goes when the last of them stops', async () => {
  const read = vi.fn(async (path: string) => `text of ${path}`);
  const previews = new FilePreviews(read, model);
  const [list, preview] = await Promise.all([previews.reference('/project/job_spec.lua'), previews.reference('/project/job_spec.lua')]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(list.model).toBe(preview.model); expect(list.model.text).toBe('text of /project/job_spec.lua');
  list.dispose(); list.dispose();
  expect(list.model.dispose).not.toHaveBeenCalled();
  preview.dispose();
  await vi.waitFor(() => expect(list.model.dispose).toHaveBeenCalledTimes(1));
  // Looked at again later, it is read again: the file may have changed.
  const again = await previews.reference('/project/job_spec.lua');
  expect(read).toHaveBeenCalledTimes(2); expect(again.model).not.toBe(list.model);
});
it('a file that cannot be read is no preview, and is tried again the next time', async () => {
  const read = vi.fn().mockRejectedValueOnce(Error('This file is not text.')).mockResolvedValueOnce('now it is');
  const previews = new FilePreviews(read, model);
  await expect(previews.reference('/project/data.bin')).rejects.toThrow('This file is not text.');
  expect((await previews.reference('/project/data.bin')).model.text).toBe('now it is');
});
