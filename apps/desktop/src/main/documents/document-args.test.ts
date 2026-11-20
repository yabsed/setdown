import { expect, test } from 'vitest';
import { relaunchOptions } from './document-args';

test('a start that the quitting app could not serve is repeated with its own command line', () => {
  // What Chromium hands over for the second start: its program, then its arguments.
  expect(relaunchOptions(['/opt/setdown/setdown', '--ozone-platform=x11', '/home/me/notes.md'], {})).toEqual({ args: ['--ozone-platform=x11', '/home/me/notes.md'] });
  // In development the first argument is the app folder; it is part of the start.
  expect(relaunchOptions(['/repo/node_modules/electron/dist/electron', '.', '--files'], {})).toEqual({ args: ['.', '--files'] });
  expect(relaunchOptions(['/opt/setdown/setdown'], {})).toEqual({ args: [] });
  // The program of an AppImage lives in a mount that ends with the process: the image itself is started.
  expect(relaunchOptions(['/tmp/.mount_Setdown/setdown', 'a.md'], { APPIMAGE: '/home/me/Apps/Setdown.AppImage' })).toEqual({ args: ['a.md'], execPath: '/home/me/Apps/Setdown.AppImage' });
  expect(relaunchOptions(['/opt/setdown/setdown'], { APPIMAGE: 'relative.AppImage' })).toEqual({ args: [] });
});
