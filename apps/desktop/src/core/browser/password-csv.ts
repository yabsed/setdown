import { PASSWORD_LIMITS, typedPasswordOrigin, type PasswordRow } from './passwords';

const MAX_BYTES = 5 * 1024 * 1024;
// Column names other browsers and password managers write for the same three facts.
const ALIASES: Record<'url' | 'username' | 'password', string[]> = {
  url: ['url', 'website', 'web site', 'origin', 'hostname', 'login_uri', 'login uri', 'uri'],
  username: ['username', 'user name', 'user', 'login', 'login_username', 'account', 'email'],
  password: ['password', 'login_password'],
};

/** RFC 4180 records: quoted fields may contain commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, started = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[index + 1] === '"') { field += '"'; index++; }
      else quoted = false;
    } else if (char === '"' && field === '') { quoted = true; started = true; }
    else if (char === ',') { row.push(field); field = ''; started = true; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      if (started || field !== '' || row.length) { row.push(field); rows.push(row); }
      row = []; field = ''; started = false;
    } else { field += char; started = true; }
  }
  if (quoted) throw Error('This CSV file ends inside a quoted field.');
  if (started || field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Passwords exported by Chrome, Edge, Brave, Firefox, Min, Bitwarden or
 * 1Password. Rows without a usable HTTPS (or local) address or without a
 * password are counted as skipped, never guessed at.
 */
export function parsePasswordCsv(text: string): { rows: PasswordRow[]; skipped: number } {
  if (text.length > MAX_BYTES) throw Error('Password files must be smaller than 5 MiB.');
  const [header, ...records] = parseCsv(text);
  if (!header) throw Error('This file has no rows.');
  const columns: Partial<Record<'url' | 'username' | 'password', number>> = {};
  header.forEach((raw, index) => {
    const name = raw.trim().toLowerCase().replace(/["']/g, '');
    for (const key of ['url', 'username', 'password'] as const) {
      if (!ALIASES[key].includes(name)) continue;
      if (columns[key] !== undefined) throw Error(`This CSV has more than one “${key}” column.`);
      columns[key] = index;
    }
  });
  const { url, username, password } = columns;
  if (url === undefined || username === undefined || password === undefined) throw Error('Choose a password CSV with url, username and password columns.');
  if (records.length > PASSWORD_LIMITS.entries) throw Error(`Password files may contain at most ${PASSWORD_LIMITS.entries.toLocaleString('en-US')} rows.`);
  const rows = new Map<string, PasswordRow>();
  let skipped = 0;
  for (const record of records) {
    const origin = typedPasswordOrigin(record[url] ?? ''), user = (record[username] ?? '').trim(), secret = record[password] ?? '';
    if (!origin || !secret || user.length > PASSWORD_LIMITS.username || secret.length > PASSWORD_LIMITS.password) { skipped++; continue; }
    const key = `${origin}\n${user}`;
    // A later row for the same login replaces the earlier one.
    if (rows.has(key)) skipped++;
    rows.set(key, { origin, username: user, password: secret });
  }
  return { rows: [...rows.values()], skipped };
}

const quote = (value: string) => /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** The column layout Chrome writes, which the other browsers and managers read. */
export function serializePasswordCsv(rows: PasswordRow[]): string {
  const lines = ['name,url,username,password,note'];
  for (const row of rows) lines.push([new URL(row.origin).hostname, `${row.origin}/`, row.username, row.password, ''].map(quote).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
