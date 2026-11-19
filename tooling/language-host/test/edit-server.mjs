// A language server whose only skill is asking its client to change files. It stands in
// for a real server's binary so that a test can see what the host does with that request.
let buffer = Buffer.alloc(0), next = 1;
const waiting = new Map();
const send = message => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body);
};
const ask = (method, params) => new Promise(resolve => { const id = `edit-${next++}`; waiting.set(id, resolve); send({ id, method, params }); });
async function handle(message) {
  if (message.method === undefined) { waiting.get(message.id)?.(message); waiting.delete(message.id); return; }
  if (message.id === undefined) { if (message.method === 'exit') process.exit(0); return; }
  if (message.method === 'initialize') return send({ id: message.id, result: {
    capabilities: { textDocumentSync: 1, executeCommandProvider: { commands: ['setdown.edit'] } }, serverInfo: { name: 'edit-server' } } });
  if (message.method === 'workspace/executeCommand') {
    const [uri, created] = message.params.arguments;
    const reply = await ask('workspace/applyEdit', { label: 'Test edit', edit: { documentChanges: [
      { kind: 'create', uri: created },
      { textDocument: { uri, version: null }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'EDITED\n' }] },
    ] } });
    return send({ id: message.id, result: reply.result ?? { error: reply.error } });
  }
  send({ id: message.id, result: null });
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()); buffer = buffer.subarray(end + 4 + length);
    void handle(message);
  }
});
