import { rebuild } from '@electron/rebuild';
import { Arch } from 'electron-builder';
import { fileURLToPath } from 'node:url';

/** Chromium supplies the app's canvas. Fabric's browser entry and TikZ's SVG
 * DOM processing do not use jsdom's optional Cairo-backed Node canvas. Keep
 * every other production/optional native dependency eligible for rebuilding. */
export default async function beforePack({ packager, electronPlatformName, arch }) {
  console.info('Rebuilding Electron native dependencies (excluding unused optional canvas).');
  const rebuilding = rebuild({
    buildPath: packager.info.appDir,
    projectRootPath: fileURLToPath(new URL('../../../', import.meta.url)),
    electronVersion: packager.info.framework.version,
    platform: electronPlatformName,
    arch: Arch[arch],
    mode: 'sequential',
    buildFromSource: packager.config.buildDependenciesFromSource === true,
    disablePreGypCopy: true,
    ignoreModules: ['canvas'],
  });
  rebuilding.lifecycle.on('module-found', name => {
    if (name !== 'canvas') console.info(`  native: ${name}`);
  });
  await rebuilding;
  // Use beforePack rather than a false-returning beforeBuild: the latter also
  // disables electron-builder's workspace dependency collection.
}
