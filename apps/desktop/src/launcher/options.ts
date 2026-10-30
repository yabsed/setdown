import { displayBackend } from '../main/windows/display-backend';

/** Choose Ozone before starting Electron so its main-process fallback never
 * needs to relaunch a child tracked by concurrently. */
export function electronLaunchOptions(platform: string, environment: NodeJS.ProcessEnv, input: string[]) {
  const args = [...input], env = { ...environment };
  delete env.ELECTRON_RUN_AS_NODE;
  const inline = args.find(value => value.startsWith('--ozone-platform='));
  const separate = args.indexOf('--ozone-platform');
  const requested = inline?.split('=')[1] ?? (separate >= 0 ? args[separate + 1] : '') ?? '';
  if (displayBackend(platform, env, requested) === 'x11' && requested !== 'x11') {
    if (separate >= 0) args.splice(separate, 2);
    const index = args.findIndex(value => value.startsWith('--ozone-platform='));
    if (index >= 0) args.splice(index, 1);
    args.unshift('--ozone-platform=x11');
  }
  return { args, env };
}
