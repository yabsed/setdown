// A bare Electron window that loads one built page from file://, as Setdown's renderer is loaded.
const { app, BrowserWindow } = require('electron');
const page = process.argv[process.argv.length - 1];
// Exact heap sizes instead of Chromium's coarse buckets.
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1400, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadFile(page);
});
app.on('window-all-closed', () => app.quit());
