import { describe, expect, it } from 'vitest';
import { acceptedPaths, activationAccepts, canAccept, canAcceptSelection, checkName, nameSelection, visibleInPicker, withFilterExtension } from './picker-rules';

const file = (path: string) => ({ path, directory: false });
const folder = (path: string) => ({ path, directory: true });
const open = (files: boolean, folders: boolean, multiple = false) => ({ kind: 'open' as const, files, folders, multiple });

describe('picker acceptance follows GNOME Files modes', () => {
  it('accepts exactly one file for a single-file request', () => {
    expect(canAcceptSelection(open(true, false), [file('/a.md')])).toBe(true);
    expect(canAcceptSelection(open(true, false), [file('/a.md'), file('/b.md')])).toBe(false);
    expect(canAcceptSelection(open(true, false), [folder('/docs')])).toBe(false);
  });

  it('requires every item of a multiple request to match the requested kind', () => {
    expect(canAcceptSelection(open(true, false, true), [file('/a'), file('/b')])).toBe(true);
    expect(canAcceptSelection(open(false, true, true), [folder('/a'), file('/b')])).toBe(false);
    expect(canAcceptSelection(open(true, true, true), [folder('/a'), file('/b')])).toBe(true);
  });

  it('returns the current folder when a folder request has no fitting selection', () => {
    const request = open(false, true);
    expect(acceptedPaths(request, [], { path: '/home/me' })).toEqual(['/home/me']);
    expect(acceptedPaths(request, [file('/home/me/a.txt')], { path: '/home/me' })).toEqual(['/home/me']);
    expect(acceptedPaths(request, [folder('/home/me/docs')], { path: '/home/me' })).toEqual(['/home/me/docs']);
  });

  it('cannot accept a virtual place as the current folder', () => {
    const request = open(false, true);
    expect(canAccept(request, [], { path: '/trash', virtual: true })).toBe(false);
    expect(acceptedPaths(request, [], { path: '/trash', virtual: true })).toEqual([]);
  });

  it('accepts nothing for a file request with an empty selection', () => {
    expect(canAccept(open(true, false), [], { path: '/home/me' })).toBe(false);
    expect(acceptedPaths(open(true, false), [], { path: '/home/me' })).toEqual([]);
  });

  it('lets activation accept files but navigate folders', () => {
    expect(activationAccepts(open(true, false), file('/a.md'))).toBe(true);
    expect(activationAccepts(open(true, false), folder('/docs'))).toBe(false);
    expect(activationAccepts(open(false, true), file('/a.md'))).toBe(false);
  });

  it('requires a valid name for save requests', () => {
    const save = { kind: 'save' as const, files: true, folders: false, multiple: false };
    expect(canAccept(save, [], { path: '/home/me' }, checkName('notes.md'))).toBe(true);
    expect(canAccept(save, [], { path: '/home/me' }, checkName(''))).toBe(false);
  });
});

describe('picker filters', () => {
  const markdown = { name: 'Markdown', extensions: ['md', 'markdown'] };
  it('never hides folders and matches extensions case-insensitively', () => {
    expect(visibleInPicker({ name: 'docs', directory: true }, open(true, false), markdown)).toBe(true);
    expect(visibleInPicker({ name: 'README.MD', directory: false }, open(true, false), markdown)).toBe(true);
    expect(visibleInPicker({ name: 'image.png', directory: false }, open(true, false), markdown)).toBe(false);
    expect(visibleInPicker({ name: 'image.png', directory: false }, open(true, false), { name: 'All', extensions: ['*'] })).toBe(true);
  });
  it('matches compound extensions', () => {
    expect(visibleInPicker({ name: 'backup.tar.gz', directory: false }, open(true, false), { name: 'Archives', extensions: ['tar.gz'] })).toBe(true);
  });
});

describe('save names', () => {
  it('uses GNOME Files validation messages', () => {
    expect(checkName('a/b').message).toBe('File names cannot contain “/”');
    expect(checkName('..').valid).toBe(false);
    expect(checkName('x'.repeat(256)).message).toBe('File name is too long');
    expect(checkName('가'.repeat(86)).valid).toBe(false);
    expect(checkName('.env').warning).toMatch(/hidden/);
    expect(checkName('notes.md', { directory: false })).toMatchObject({ valid: true, exists: 'file' });
    expect(checkName('docs', { directory: true })).toMatchObject({ valid: false, exists: 'directory' });
  });

  it('appends the active filter extension like VS Code', () => {
    const filters = [{ name: 'PDF', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }];
    expect(withFilterExtension('report', filters, filters[0])).toBe('report.pdf');
    expect(withFilterExtension('report.pdf', filters, filters[0])).toBe('report.pdf');
    expect(withFilterExtension('report', filters, filters[1])).toBe('report');
  });

  it('selects the base name without the extension', () => {
    expect(nameSelection('notes.md')).toEqual([0, 5]);
    expect(nameSelection('archive.tar.gz')).toEqual([0, 7]);
    expect(nameSelection('.env')).toEqual([0, 4]);
    expect(nameSelection('Makefile')).toEqual([0, 8]);
  });
});
