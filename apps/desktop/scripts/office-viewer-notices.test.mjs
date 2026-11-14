import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OFFICE_VIEWER_PACKAGES, officeViewerClosure, officeViewerNotices } from './office-viewer-notices.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Office viewer notices cover the bundled File Viewer packages and their engines', () => {
  const closure = officeViewerClosure(root);
  const names = closure.map(item => item.name);
  for (const name of [...OFFICE_VIEWER_PACKAGES, '@file-viewer/core', '@file-viewer/docx', '@file-viewer/doc', '@file-viewer/pptx', '@file-viewer/ppt',
    '@ssabrojs/hwpxjs', 'styled-exceljs', 'e-virt-table', 'jszip']) assert.ok(names.includes(name), `${name} is missing from the closure`);
  // Every File Viewer package is pinned to one release line, matching the submodule checkout.
  const versions = new Set(closure.filter(item => /^@file-viewer\/(core|web|renderer-)/.test(item.name)).map(item => item.version));
  assert.equal(versions.size, 1);
  const notices = officeViewerNotices(root);
  for (const item of closure) assert.ok(notices.includes(`=== ${item.name}@${item.version} (`), `${item.name} has no section`);
  for (const name of OFFICE_VIEWER_PACKAGES) assert.match(notices, new RegExp(`--- ${name.replace('/', '\\/')}@[\\d.]+: LICENSE ---\\n\\s*Apache License`));
  assert.match(notices, /--- @file-viewer\/pptx@[\d.]+: dist\/worker\.THIRD_PARTY_LICENSES\.txt ---/);
});
