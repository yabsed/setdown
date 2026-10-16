import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
export const suites = JSON.parse(readFileSync(new URL('../test/suites.json', import.meta.url), 'utf8'));
export const e2eFiles = (contract = false, manifest = suites) => Object.entries(manifest.e2e)
  .filter(([, metadata]) => !contract || metadata.previewContract)
  .map(([file]) => `test/e2e/${file}`);

function files(root, folder) {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(root, file) : [file];
  });
}

/** Fail before collection: a moved/new/deleted spec cannot silently leave a suite. */
export function validateSuites(manifest = suites, root = desktopRoot) {
  const errors = [];
  if (manifest.schema !== 1) errors.push('Unknown test suite schema');
  for (const [file, metadata] of Object.entries(manifest.e2e)) {
    if (!/^[a-z-]+\/[\w/-]+\.spec\.ts$/.test(file) || file.includes('..')) errors.push(`Invalid E2E path: ${file}`);
    if (typeof metadata.previewContract !== 'boolean') errors.push(`Classify preview-contract membership: ${file}`);
  }
  const specs = [...e2eFiles(false, manifest), ...Object.values(manifest.external).flatMap(suite => suite.files)];
  const actual = files(root, 'test').filter(file => /(?:\.spec\.ts|\.test\.py)$/.test(file));
  for (const file of actual) if (!specs.includes(file)) errors.push(`Unclassified test: ${file}`);
  for (const file of specs) if (!actual.includes(file)) errors.push(`Missing classified test: ${file}`);
  const contract = manifest.unit.previewContract;
  for (const file of contract) {
    if (!/^src\/.+\.test\.ts$/.test(file) || !existsSync(path.join(root, file))) errors.push(`Missing contract unit: ${file}`);
  }
  for (const [name, list] of [['classified tests', specs], ['contract units', contract], ['benchmark', manifest.benchmark.files]]) {
    if (new Set(list).size !== list.length) errors.push(`Duplicate ${name}`);
  }
  for (const file of manifest.benchmark.files) if (!e2eFiles(false, manifest).includes(file)) errors.push(`Unclassified benchmark: ${file}`);
  for (const file of manifest.benchmark.support) if (!existsSync(path.join(root, file))) errors.push(`Missing benchmark support: ${file}`);
  if (errors.length) throw Error(errors.join('\n'));
  return { unitContract: contract.length, e2e: e2eFiles(false, manifest).length,
    e2eContract: e2eFiles(true, manifest).length, external: Object.keys(manifest.external).length };
}
