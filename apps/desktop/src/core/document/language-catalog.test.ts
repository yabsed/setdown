import { expect, test } from 'vitest';
import { catalogLanguage, languageDefinitions, languageDefinition } from './language-catalog';
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
