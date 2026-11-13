import { expect, test } from 'vitest';
import { parseCsv, parsePasswordCsv, serializePasswordCsv } from './password-csv';
import { passwordOrigin, typedPasswordOrigin } from './passwords';

test('logins are keyed by exact origin and only kept for HTTPS or this machine', () => {
  expect(passwordOrigin('https://Example.com/login?next=1')).toBe('https://example.com');
  // Only an address a person typed may omit its scheme. A frame's opaque origin must never become a site.
  expect(typedPasswordOrigin('example.com')).toBe('https://example.com');
  expect(typedPasswordOrigin('localhost:3000')).toBeNull();
  expect(typedPasswordOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  expect(passwordOrigin('example.com')).toBeNull();
  expect(passwordOrigin('https://example.com:8443/')).toBe('https://example.com:8443');
  expect(passwordOrigin('http://127.0.0.1:3000/a')).toBe('http://127.0.0.1:3000');
  expect(passwordOrigin('http://localhost/')).toBe('http://localhost');
  // A plain-HTTP site can be read and rewritten in transit; another scheme is not a web login.
  for (const input of ['http://example.com', 'ftp://example.com', 'android://hash@com.app/', 'https://user:pw@example.com', 'null', '', 'chrome-extension://abc/'])
    expect(passwordOrigin(input)).toBeNull();
  expect(passwordOrigin('https://a.example.com')).not.toBe(passwordOrigin('https://example.com'));
});

test('CSV records keep commas, quotes, line breaks and Unicode inside quoted fields', () => {
  expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\n\n한글,\n')).toEqual([['a', 'b'], ['x, "y"', 'line\nbreak'], ['한글', '']]);
  expect(parseCsv('')).toEqual([]);
  expect(() => parseCsv('a,"open')).toThrow('quoted');
});

test('password files from Chrome, Firefox and Min are read by column name; unusable rows are skipped', () => {
  const chrome = 'name,url,username,password,note\nexample.com,https://example.com/login,ann,"p,w ""1""",\nlocal,http://127.0.0.1:8080/,dev,secret,\n'
    + 'plain,http://insecure.example/,ann,x,\napp,android://hash@com.example/,ann,x,\nempty,https://empty.example/,ann,,\nexample.com,https://example.com/other,ann,newer,\n';
  const parsed = parsePasswordCsv(chrome);
  expect(parsed.rows).toEqual([
    { origin: 'https://example.com', username: 'ann', password: 'newer' },
    { origin: 'http://127.0.0.1:8080', username: 'dev', password: 'secret' },
  ]);
  expect(parsed.skipped).toBe(4);
  expect(parsePasswordCsv('"url","username","password","httpRealm","formActionOrigin"\n"https://fx.example","","only-password","",""\n').rows)
    .toEqual([{ origin: 'https://fx.example', username: '', password: 'only-password' }]);
  expect(parsePasswordCsv('URL, Username ,Password\nmin.example,me,pw\n').rows).toEqual([{ origin: 'https://min.example', username: 'me', password: 'pw' }]);
  expect(parsePasswordCsv('login_uri,login_username,login_password\nhttps://bw.example,me,pw\n').rows).toHaveLength(1);
  expect(() => parsePasswordCsv('url,username\nhttps://a.example,me\n')).toThrow('url, username and password');
  expect(() => parsePasswordCsv('url,website,username,password\n')).toThrow('more than one “url”');
  expect(() => parsePasswordCsv('')).toThrow('no rows');
  expect(() => parsePasswordCsv('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MiB');
});

test('exported passwords use the layout other browsers import and survive a round trip', () => {
  const rows = [
    { origin: 'https://example.com', username: 'ann, "the" admin', password: ' lead"ing\nline ' },
    { origin: 'http://localhost:3000', username: '한글', password: 'pw' },
  ];
  const csv = serializePasswordCsv(rows);
  expect(csv.startsWith('name,url,username,password,note\r\nexample.com,https://example.com/,')).toBe(true);
  expect(parsePasswordCsv(csv)).toEqual({ rows, skipped: 0 });
});
