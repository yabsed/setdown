// Prints what the engine says about documents it did not open.
import { launch } from './drive.mjs';
const [kind, ...files] = process.argv.slice(2);
const session = await launch(kind);
try {
  for (const file of files) {
    const report = await session.open(file);
    const { themeColors, slides, sheets, ...snapshot } = report.snapshot ?? {};
    console.log('==', file.split('/').pop(), JSON.stringify({ failure: report.failure, result: report.result, snapshot }).slice(0, 1200));
  }
} finally { await session.close(); }
