import { app, dialog, shell, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { desktopFile } from '../files/desktop-integration';

const exec = promisify(execFile);
const DESKTOP_ID = 'setdown.desktop';
const SCHEME_TYPES = ['x-scheme-handler/http', 'x-scheme-handler/https'];
const WINDOWS_PROG_ID = 'SetdownURL';

/** An installed desktop entry can be the browser only if it declares both schemes and takes URLs. */
export function handlesWebAddresses(entry: string): boolean {
  const section = /^\[Desktop Entry\][^\n]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(entry)?.[1] ?? '';
  const value = (key: string) => new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(section)?.[1].trim() ?? '';
  const types = value('MimeType').split(';');
  return SCHEME_TYPES.every(type => types.includes(type)) && /%[uU]/.test(value('Exec'));
}

/**
 * Windows lists an application under Settings → Default apps once it registers
 * these per-user capabilities (as Min does). Windows 10 and later let only the
 * user make the final choice there, so nothing here changes the default itself.
 */
export function windowsBrowserRegistration(executable: string): Array<{ key: string; name?: string; value: string }> {
  const client = 'HKCU\\Software\\Clients\\StartMenuInternet\\Setdown', protocol = `HKCU\\Software\\Classes\\${WINDOWS_PROG_ID}`;
  const icon = `${executable},0`;
  return [
    { key: protocol, value: 'Setdown Web Address' },
    { key: protocol, name: 'URL Protocol', value: '' },
    { key: `${protocol}\\DefaultIcon`, value: icon },
    // `--` ends Chromium's switches: an address can never be read as an option.
    { key: `${protocol}\\shell\\open\\command`, value: `"${executable}" -- "%1"` },
    { key: client, value: 'Setdown' },
    { key: `${client}\\DefaultIcon`, value: icon },
    { key: `${client}\\shell\\open\\command`, value: `"${executable}"` },
    { key: `${client}\\Capabilities`, name: 'ApplicationName', value: 'Setdown' },
    { key: `${client}\\Capabilities`, name: 'ApplicationDescription', value: 'Files, Markdown and the web in one window.' },
    { key: `${client}\\Capabilities`, name: 'ApplicationIcon', value: icon },
    { key: `${client}\\Capabilities\\StartMenu`, name: 'StartMenuInternet', value: 'Setdown' },
    { key: `${client}\\Capabilities\\URLAssociations`, name: 'http', value: WINDOWS_PROG_ID },
    { key: `${client}\\Capabilities\\URLAssociations`, name: 'https', value: WINDOWS_PROG_ID },
    { key: 'HKCU\\Software\\RegisteredApplications', name: 'Setdown', value: 'Software\\Clients\\StartMenuInternet\\Setdown\\Capabilities' },
  ];
}

type State = { kind: 'default' | 'available' | 'unavailable'; detail?: string };

async function linuxState(): Promise<State> {
  const location = await desktopFile(DESKTOP_ID);
  if (!location || !handlesWebAddresses(await fs.readFile(location, 'utf8').catch(() => ''))) {
    return { kind: 'unavailable', detail: 'Setdown has no installed desktop entry that accepts web addresses. Install or update Setdown (the .deb or .rpm package, or `npm run install:linux`), then choose this command again.' };
  }
  const current = await Promise.all(SCHEME_TYPES.map(type => exec('xdg-mime', ['query', 'default', type], { timeout: 10_000 })
    .then(result => result.stdout.trim(), () => '')));
  return current.every(id => id === DESKTOP_ID) ? { kind: 'default' }
    : { kind: 'available', detail: current[1] || current[0] ? `Current default: ${current[1] || current[0]}` : undefined };
}

async function windowsState(): Promise<State> {
  const chosen = await Promise.all(['http', 'https'].map(scheme => exec('reg', ['query',
    `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`, '/v', 'ProgId'], { timeout: 10_000 })
    .then(result => /ProgId\s+REG_SZ\s+(\S+)/.exec(result.stdout)?.[1] ?? '', () => '')));
  return chosen.every(id => id === WINDOWS_PROG_ID) ? { kind: 'default' } : { kind: 'available' };
}

/** File ▸ Set as Default Browser…: always the user's explicit choice, never done at install or launch. */
export async function chooseDefaultBrowser(window: BrowserWindow): Promise<void> {
  const state: State = process.platform === 'linux' ? await linuxState()
    : process.platform === 'win32' ? await windowsState()
    : { kind: 'unavailable', detail: 'Choose Setdown in this system’s default applications settings.' };
  if (window.isDestroyed()) return;
  if (state.kind !== 'available') {
    await dialog.showMessageBox(window, { type: 'info', buttons: ['OK'],
      message: state.kind === 'default' ? 'Setdown is your default browser.' : 'Setdown cannot be made the default browser yet.',
      ...(state.detail ? { detail: state.detail } : {}) });
    return;
  }
  const windows = process.platform === 'win32';
  const answer = await dialog.showMessageBox(window, { type: 'question', message: 'Make Setdown your default browser?',
    detail: `Links from other applications will open as web tabs in Setdown.${state.detail ? `\n${state.detail}` : ''}${windows ? '\nWindows asks you to confirm the choice in Settings.' : ''}`,
    buttons: ['Cancel', windows ? 'Open Settings' : 'Make Default'], defaultId: 0, cancelId: 0 });
  if (answer.response !== 1) return;
  try {
    if (windows) {
      for (const item of windowsBrowserRegistration(app.getPath('exe'))) {
        await exec('reg', ['add', item.key, ...(item.name === undefined ? ['/ve'] : ['/v', item.name]), '/t', 'REG_SZ', '/d', item.value, '/f'], { timeout: 10_000 });
      }
      await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Setdown');
      return;
    }
    await exec('xdg-mime', ['default', DESKTOP_ID, ...SCHEME_TYPES], { timeout: 10_000 });
    if ((await linuxState()).kind !== 'default') throw Error('The desktop did not accept the change.');
    if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: 'info', message: 'Setdown is now your default browser.', buttons: ['OK'] });
  } catch (error) {
    dialog.showErrorBox('Could not change the default browser', error instanceof Error ? error.message : String(error));
  }
}
