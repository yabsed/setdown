import { expect, test } from 'vitest';
import { catalogLanguage, languageDefinitions, languageDefinition, languageDisplayName } from './language-catalog';
import { documentLanguage } from './document-profile';
import source from './catalog/languages.json';

test('server-independent catalog recognizes build files, dialects, shebangs and uncommon languages', () => {
  for (const [file,id] of Object.entries({Makefile:'make',GNUmakefile:'make','rules.mk':'make','values.yaml':'yaml',
    '.github/workflows/ci.yml':'github-action','compose.yaml':'dockercompose','.gitlab-ci.yml':'gitlab-ci',
    'CMakeLists.txt':'cmake','Justfile':'just','main.f90':'fortran','main.zig':'zig','app.clj':'clojure'}))
    expect(documentLanguage(file,[]),file).toBe(id);
  expect(catalogLanguage('program','#!/usr/bin/env -S python3 -u')?.id).toBe('python');
  expect(catalogLanguage('script','#!/bin/sh')?.id).toBe('shell');
  expect(languageDefinition('make')).toMatchObject({grammar:'make',insertSpaces:false,lineComment:'#'});
  for (const id of ['yaml','github-action','dockercompose','gitlab-ci']) expect(languageDefinition(id)?.grammar).toBe('yaml');
});
test('complete upstream metadata preserves grammar-only languages and lazy external grammars', () => {
  expect(source.sources.zed).toMatch(/^[a-f0-9]{40}$/);
  expect(languageDefinitions.length).toBeGreaterThan(700);
  expect(languageDefinitions.filter(l=>l.treeSitter).length).toBeGreaterThan(400);
  expect(languageDefinitions.some(l=>!l.servers?.length && l.grammar)).toBe(true);
  expect(languageDefinitions.filter(l=>l.blockComment).every(l=>l.blockComment!.length===2 && l.blockComment!.every(s=>typeof s==='string'))).toBe(true);
});
test('a language is called by a written name, not by its id in lower case', () => {
  // The editor's own registration of Clojure names it "clojure" first.
  expect(languageDisplayName('clojure', ['clojure', 'Clojure'])).toBe('Clojure');
  // A catalog entry whose label only repeats the id: the name Zed gives the language.
  expect(languageDisplayName('sway', ['sway', 'sway'])).toBe('Sway');
  // A name that is already written stays as the editor has it.
  expect(languageDisplayName('typescript', ['TypeScript', 'ts', 'typescript'])).toBe('TypeScript');
  expect(languageDisplayName('shell', ['Shell', 'sh'])).toBe('Shell');
  // Nobody wrote a name: the id is all there is.
  expect(languageDisplayName('unknown-thing', ['unknown-thing'])).toBe('unknown-thing');
  expect(languageDisplayName('unknown-thing')).toBe('unknown-thing');
});
