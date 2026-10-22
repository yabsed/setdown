const { app, BrowserWindow } = require('electron');
if (!process.env.SETDOWN_AUDIT_PROFILE) throw Error('An isolated test profile is required.');
app.setPath('userData', process.env.SETDOWN_AUDIT_PROFILE);
app.enableSandbox();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><div id="unicode"><p>İx</p></div><div id="hidden"><p style="display:none !important">secret</p><p>shown</p></div>'));
});
app.on('window-all-closed', () => app.quit());
