import { spawn } from 'node:child_process';
import { electronLaunchOptions } from './options';

const { args, env } = electronLaunchOptions(process.platform, process.env, process.argv.slice(2));
const child = spawn(require('electron') as string, args, { env, stdio: 'inherit' });
// Keep the launcher alive for the actual GUI process and propagate shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error('Could not launch Electron:', error.message); process.exitCode = 1; });
child.once('close', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
