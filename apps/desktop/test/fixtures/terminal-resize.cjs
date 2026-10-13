const fs = require('node:fs');
const left = 'RESIZE-LEFT', right = 'RESIZE-RIGHT-STATUS';
let line = '', drawn = false;
process.stdout.write('HISTORY-START-' + '0123456789'.repeat(18) + '-HISTORY-END\r\n');
function draw() {
  if (drawn) process.stdout.write('\r\x1b[1A\x1b[J');
  const gap = Math.max(0, process.stdout.columns - left.length - right.length - 1);
  process.stdout.write(left + ' '.repeat(gap) + right + '\r\n> ' + line);
  drawn = true;
}
// Like zsh, redraw from the recorded two-line prompt position on SIGWINCH.
process.stdout.on('resize', draw);
process.stdin.setRawMode(true);
process.stdin.on('data', data => {
  const text = data.toString();
  if (text.includes('\x03')) {
    fs.writeFileSync('typed.txt', line);
    fs.writeFileSync('grid.txt', `${process.stdout.rows} ${process.stdout.columns}\n`);
    process.exit(0);
  }
  line += text; process.stdout.write(text);
});
draw();
