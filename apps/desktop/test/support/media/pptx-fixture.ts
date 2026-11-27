import { readFile } from 'node:fs/promises';
import { docxParts, zip } from './docx-fixture';

/** What a test reads back from a saved presentation, and how it derives one deck from another. */
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const text = (parts: Map<string, Buffer>, name: string) => {
  const part = parts.get(name);
  if (!part) throw Error(`The package has no ${name}.`);
  return part.toString('utf8');
};
export type SavedSlide = { part: string; xml: string; paragraphs: string[] };

/** The slides in the order the presentation shows them, each with the text of its paragraphs. Throws on anything that is not a presentation package. */
export function pptxSlides(bytes: Buffer): SavedSlide[] {
  const parts = docxParts(bytes);
  const targets = new Map([...text(parts, 'ppt/_rels/presentation.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(tag =>
    [/\bId="([^"]*)"/.exec(tag[0])![1], /\bTarget="([^"]*)"/.exec(tag[0])![1]] as const));
  const list = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(text(parts, 'ppt/presentation.xml'))?.[1] ?? '';
  return [...list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]*)"/g)].map(slide => {
    const target = targets.get(slide[1])!, part = target.startsWith('/') ? target.slice(1) : `ppt/${target}`, xml = text(parts, part);
    return { part, xml, paragraphs: [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g)].map(paragraph =>
      [...paragraph[0].matchAll(/<a:t(?: [^>]*)?>([^<]*)<\/a:t>/g)].map(run => unescape(run[1])).join('')) };
  });
}
export const readPptxSlides = async (file: string) => pptxSlides(await readFile(file));
/** Every part of a package by name, decoded. */
export const pptxParts = async (file: string) => docxParts(await readFile(file));

/** The same package with some parts rewritten: `rewrite` returns the new text of a part, or nothing to keep it. */
export function pptxWith(bytes: Buffer, rewrite: (name: string, xml: string) => string | undefined): Buffer {
  return zip([...docxParts(bytes)].map(([name, content]) => {
    const changed = /\.(xml|rels)$/.test(name) ? rewrite(name, content.toString('utf8')) : undefined;
    return [name, changed ?? content] as const;
  }));
}

/**
 * What an XML part says, whatever its spelling. The presentation engine writes every XML part again on
 * save: an empty element becomes self-closing and the declaration gets `standalone`. The content stays.
 */
export const xmlContent = (xml: string): string => xml.replace(/^﻿?<\?xml[^>]*\?>\s*/, '')
  // Line breaks between elements say nothing; white space after the start of a text run (`a:t`) is text.
  .replace(/(<[^<>]*>)\s+(?=<)/g, (whole, tag: string) => /^<a:t[\s>]/.test(tag) ? whole : tag)
  .replace(/<([^\s<>/]+)((?:\s[^<>]*?)?)><\/\1>/g, '<$1$2/>').trim();

/** The same deck saved as a slide show (.ppsx): the package differs only in the type of its main part. */
export const asSlideShow = (bytes: Buffer): Buffer => pptxWith(bytes, (name, xml) => name === '[Content_Types].xml'
  ? xml.replace('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml') : undefined);
