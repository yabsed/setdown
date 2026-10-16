import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import {
  crxZipOffset, extensionIdFromKey, localExtensionDir, manifestRoot,
  parseExtensionManifest, parseManifestEntries, permissionSummaryLines,
  unpackExtensionArchive, unzipArchive,
} from './extension-package';

function zip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const compressed = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralStart = offset;
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, central, eocd]);
}

const manifest = {
  manifest_version: 3, name: '__MSG_appName__', version: '1.2.3', description: 'Test',
  default_locale: 'en', action: { default_popup: 'popup.html' }, options_page: 'options.html',
  permissions: ['storage', 'cookies', 'https://example.com/*'], host_permissions: ['https://*.news.example/*'],
};
const messages = { appName: { message: 'News Helper' } };

describe('extension packages', () => {
  test('derives the Chrome extension ID from a manifest key', () => {
    const der = Buffer.from('setdown-test-public-key-bytes-0123456789');
    const expected = createHash('sha256').update(der).digest().subarray(0, 16);
    const id = extensionIdFromKey(der.toString('base64'))!;
    expect(id).toHaveLength(32);
    expect(id[0]).toBe(String.fromCharCode(97 + (expected[0] >> 4)));
    expect(extensionIdFromKey('not base64!!')).toBeUndefined();
    expect(localExtensionDir({ name: 'News Helper' })).toMatch(/^local-news-helper-[0-9a-f]{8}$/);
  });

  test('parses MV3 manifests with localization and host permissions', () => {
    const info = parseExtensionManifest(manifest, messages);
    expect(info).toMatchObject({ name: 'News Helper', version: '1.2.3', manifestVersion: 3,
      popupPath: 'popup.html', optionsPath: 'options.html', permissions: ['storage', 'cookies'] });
    expect(info.hostPermissions).toEqual(expect.arrayContaining(['https://example.com/*', 'https://*.news.example/*']));
    expect(() => parseExtensionManifest({ manifest_version: 4, name: 'x', version: '1' })).toThrow(/V2 and V3/);
    expect(() => parseExtensionManifest({ manifest_version: 2, version: '1' })).toThrow(/no name/);
  });

  test('installation summary includes content-script hosts and optional permissions', () => {
    const info = parseExtensionManifest({ ...manifest, host_permissions: [], permissions: ['storage', 'activeTab'],
      content_scripts: [{ matches: ['https://chatgpt.com/*'] }], optional_permissions: ['proxy'], optional_host_permissions: ['https://example.com/*'] }, messages);
    expect(permissionSummaryLines(info)).toEqual(['• storage', '• activeTab', '• Scripts on https://chatgpt.com/*', '• Optional: proxy', '• Optional access to https://example.com/*']);
  });

  test('extracts stored and deflated ZIP entries under a wrapping folder', () => {
    const archive = zip([
      { name: 'pkg/manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { name: 'pkg/_locales/en/messages.json', data: Buffer.from(JSON.stringify(messages)), deflate: true },
      { name: 'pkg/popup.html', data: Buffer.from('<p>hi</p>'), deflate: true },
    ]);
    const entries = unzipArchive(archive);
    expect(entries.map(entry => entry.name)).toContain('pkg/popup.html');
    expect(manifestRoot(entries.map(entry => entry.name))).toBe('pkg/');
    const parsed = parseManifestEntries(entries);
    expect(parsed.root).toBe('pkg/');
    expect(parsed.info.name).toBe('News Helper');
  });

  test('rejects ZIP entries that escape the install directory', () => {
    const archive = zip([{ name: '../evil.js', data: Buffer.from('x') }]);
    expect(() => unzipArchive(archive)).toThrow(/unsafe path/);
    expect(() => unzipArchive(Buffer.from('nope'))).toThrow(/Not a ZIP/);
  });

  test('locates the ZIP payload inside CRX v2 and v3 files', () => {
    const payload = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ manifest_version: 2, name: 'x', version: '1' })) }]);
    const v3 = Buffer.alloc(12);
    v3.write('Cr24', 0, 'latin1'); v3.writeUInt32LE(3, 4); v3.writeUInt32LE(7, 8);
    const crx3 = Buffer.concat([v3, Buffer.alloc(7), payload]);
    expect(crxZipOffset(crx3)).toBe(19);
    expect(parseManifestEntries(unpackExtensionArchive(crx3)).info.manifestVersion).toBe(2);
    const v2 = Buffer.alloc(16);
    v2.write('Cr24', 0, 'latin1'); v2.writeUInt32LE(2, 4); v2.writeUInt32LE(5, 8); v2.writeUInt32LE(3, 12);
    expect(crxZipOffset(Buffer.concat([v2, Buffer.alloc(8), payload]))).toBe(24);
    expect(() => crxZipOffset(Buffer.from('XXXX........'))).toThrow(/Not a CRX/);
  });

  test('bounds the permission summary for manifests with many host permissions', () => {
    // Bypass Paywalls Clean requests ~970 host permissions. The native
    // confirmation dialog must stay a handful of lines, not one per site.
    const info = parseExtensionManifest({ manifest_version: 3, name: 'Many Sites', version: '1',
      permissions: ['storage', 'cookies'],
      host_permissions: Array.from({ length: 970 }, (_, i) => `*://*.site-${i}.example/*`) });
    const lines = permissionSummaryLines(info);
    expect(lines.length).toBeLessThanOrEqual(13);
    expect(lines[0]).toBe('• storage');
    expect(lines.at(-1)).toBe('• …and 960 more');
    expect(lines.join('\n').length).toBeLessThan(2_000);
    // Short lists render in full, and single entries are clipped.
    expect(permissionSummaryLines({ permissions: ['storage'], hostPermissions: [] })).toEqual(['• storage']);
    expect(permissionSummaryLines({ permissions: [], hostPermissions: [`*://${'a'.repeat(200)}.example/*`] })[0])
      .toHaveLength(92);
  });
});
