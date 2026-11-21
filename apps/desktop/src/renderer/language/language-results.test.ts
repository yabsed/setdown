import { expect, it } from 'vitest';
import { resultPlace } from './language-results';

it('a result that does not fit loses its folders: the tool, the file and the line stay', () => {
  expect(resultPlace('buf-lsp · /home/person/work/grpc-proto/grpc/gcp/handshaker.proto:22'))
    .toEqual({ before: 'buf-lsp · /home/person/work/grpc-proto/grpc/gcp/', kept: 'handshaker.proto:22' });
  expect(resultPlace('C:\\work\\app\\main.rs:7')).toEqual({ before: 'C:\\work\\app\\', kept: 'main.rs:7' });
});
it('a result that names no folder is kept whole', () => {
  expect(resultPlace('pyright · Cell 3:12')).toEqual({ before: '', kept: 'pyright · Cell 3:12' });
  expect(resultPlace('')).toEqual({ before: '', kept: '' });
});
