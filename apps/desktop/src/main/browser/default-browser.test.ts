import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }));
const { handlesWebAddresses, windowsBrowserRegistration } = await import('./default-browser');

const entry = (lines: string[]) => ['[Desktop Entry]', 'Type=Application', 'Name=Setdown', ...lines, ''].join('\n');

test('only a desktop entry that declares both web schemes and takes addresses can be the browser', () => {
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %U', 'MimeType=text/markdown;x-scheme-handler/http;x-scheme-handler/https;']))).toBe(true);
  expect(handlesWebAddresses(entry(['Exec = /opt/Setdown/setdown %u', 'MimeType = x-scheme-handler/https;x-scheme-handler/http']))).toBe(true);
  // An installation from before web addresses were accepted: files only.
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %F', 'MimeType=text/markdown;inode/directory;']))).toBe(false);
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %F', 'MimeType=x-scheme-handler/http;x-scheme-handler/https;']))).toBe(false);
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %U', 'MimeType=x-scheme-handler/http;']))).toBe(false);
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %U', 'MimeType=x-scheme-handler/httpx;x-scheme-handler/https;']))).toBe(false);
  // Keys of another group (a desktop action) do not describe the application.
  expect(handlesWebAddresses(entry(['Exec=/opt/Setdown/setdown %F', 'MimeType=text/markdown;', '[Desktop Action Web]',
    'Exec=/opt/Setdown/setdown %U', 'MimeType=x-scheme-handler/http;x-scheme-handler/https;']))).toBe(false);
  expect(handlesWebAddresses('')).toBe(false);
});

test('the Windows registration is per user, names both schemes and cannot pass an address as a switch', () => {
  const executable = 'C:\\Program Files\\Setdown\\Setdown.exe';
  const items = windowsBrowserRegistration(executable);
  expect(items.every(item => item.key.startsWith('HKCU\\Software\\'))).toBe(true);
  expect(items).toContainEqual({ key: 'HKCU\\Software\\Classes\\SetdownURL\\shell\\open\\command', value: `"${executable}" -- "%1"` });
  expect(items).toContainEqual({ key: 'HKCU\\Software\\Classes\\SetdownURL', name: 'URL Protocol', value: '' });
  for (const scheme of ['http', 'https']) {
    expect(items).toContainEqual({ key: 'HKCU\\Software\\Clients\\StartMenuInternet\\Setdown\\Capabilities\\URLAssociations', name: scheme, value: 'SetdownURL' });
  }
  expect(items).toContainEqual({ key: 'HKCU\\Software\\RegisteredApplications', name: 'Setdown', value: 'Software\\Clients\\StartMenuInternet\\Setdown\\Capabilities' });
  // Nothing claims a file type or writes the user's choice itself.
  expect(items.some(item => /UserChoice|FileAssociations/.test(item.key))).toBe(false);
});
