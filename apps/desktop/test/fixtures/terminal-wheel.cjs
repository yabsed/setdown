const fs = require('node:fs');
process.stdin.setRawMode(true);
process.stdout.write('\x1b[?1049h\x1b[2J\x1b[HTUI_READY');
if (process.argv[2] === 'mouse') process.stdout.write('\x1b[?1000h\x1b[?1006h');
process.stdin.on('data', data => {
  fs.appendFileSync('input.bin', data);
  if (data.includes(113)) { // q exits without touching the enclosing shell.
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1049l');
    process.exit(0);
  }
});
