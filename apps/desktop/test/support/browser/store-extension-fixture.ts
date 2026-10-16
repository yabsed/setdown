import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';

// A signed CRX3 fixture exercises the upstream store unpacker as well as native
// loading. Only the network response is local; installation code is unchanged.
export function storeExtensionFixture() {
  const Zip = createRequire(import.meta.url)('adm-zip');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const digest = createHash('sha256').update(key).digest().subarray(0, 16);
  const id = [...digest].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  const varint = (value: number) => {
    const bytes = []; do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value);
    return Buffer.from(bytes);
  };
  const field = (number: number, bytes: Buffer) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
  return { id, package(version: string) {
    const zip = new Zip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ manifest_version: 3,
      name: 'Store Fixture', version, description: 'Web Store installation fixture', permissions: ['storage'],
      host_permissions: ['http://127.0.0.1/*'], action: { default_popup: 'popup.html' },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }],
    })));
    zip.addFile('content.js', Buffer.from(`document.documentElement.dataset.storeFixture=${JSON.stringify(version)};`));
    zip.addFile('popup.html', Buffer.from('<!doctype html><title>Store fixture popup</title>Installed'));
    const payload = zip.toBuffer();
    const signedHeader = field(1, digest), size = Buffer.alloc(4); size.writeUInt32LE(signedHeader.length);
    const signature = sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signedHeader, payload]), privateKey);
    const proof = Buffer.concat([field(1, key), field(2, signature)]);
    const header = Buffer.concat([field(2, proof), field(10000, signedHeader)]);
    const prefix = Buffer.alloc(12); prefix.write('Cr24'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
    return Buffer.concat([prefix, header, payload]);
  } };
}
