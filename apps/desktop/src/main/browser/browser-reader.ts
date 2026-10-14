import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import { readReaderSnapshot, type ReaderAnchor, type ReaderSnapshot } from '../../core/browser/reader-article';
import { namuArticleRoot, readerBlocks, removeNamuSvg } from '../../core/browser/namu-reader';
import { GOLDEN_TOP_RATIO } from '../../core/preview/viewport-anchor';

/** Block-level candidates that can carry a reading position. The ordinal of an
 * element within this selector's document order is the anchor coordinate in
 * both directions (it plays the role of data-source-line for web pages). */
const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figure,figcaption,img,table,dd,dt';

let library: Promise<string> | undefined;
/** Mozilla Readability (vendor/readability, the Firefox Reader View library),
 * copied next to the bundled main process by scripts/build-browser.mjs. */
function readabilitySource(): Promise<string> {
  library ??= fs.readFile(path.join(__dirname, 'readability.js'), 'utf8');
  return library;
}

const extraction = `(function () {
  try {
    var BLOCKS = ${JSON.stringify(BLOCKS)};
    var doc = document;
    var namu = ['namu.wiki', 'www.namu.wiki'].includes(location.hostname) && location.pathname.startsWith('/w/');
    var getBlocks = ${readerBlocks.toString()};
    var vh = window.innerHeight || 1;
    var golden = vh * ${GOLDEN_TOP_RATIO};
    var blocks = getBlocks(doc, namu, BLOCKS);
    var anchor = null, anchorRect = null, below = null;
    for (var i = 0; i < blocks.length; i++) {
      var rect = blocks[i].getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top <= golden && rect.bottom > golden) {
        if (!anchor || rect.height < anchorRect.height) { anchor = blocks[i]; anchorRect = rect; }
      } else if (!below && rect.top > golden) below = blocks[i];
    }
    anchor = anchor || below || doc.body;
    anchorRect = anchorRect || anchor.getBoundingClientRect();
    var norm = function (value) { return (value || '').replace(/\\s+/g, ' ').trim(); };
    var scrollMax = Math.max(1, doc.documentElement.scrollHeight - vh);
    var anchorInfo = {
      ordinal: Math.max(0, blocks.indexOf(anchor)),
      yRatio: Math.max(0, Math.min(1, anchorRect.top / vh)),
      text: norm(anchor.textContent).slice(0, 80),
      scrollRatio: Math.max(0, Math.min(1, window.scrollY / scrollMax)),
    };
    var clone = doc.cloneNode(true);
    var base = clone.querySelector('base');
    if (!base) { base = clone.createElement('base'); clone.head && clone.head.prepend(base); }
    if (base) base.setAttribute('href', doc.baseURI);
    getBlocks(clone, namu, BLOCKS).forEach(function (el, index) {
      el.setAttribute('data-setdown-block', String(index));
    });
    // Strip SVG before either extraction path, so the displayed and exported
    // snapshots agree, while the live page and its block ordinals stay intact.
    if (namu) (${removeNamuSvg.toString()})(clone);
    var namuRoot = namu ? (${namuArticleRoot.toString()})(clone) : null;
    if (namuRoot) namuRoot.querySelectorAll('a[href],img').forEach(function (el) {
      var key = el.tagName === 'IMG' ? 'src' : 'href'; var value = el.getAttribute(key);
      if (value && !value.startsWith('#')) try { el.setAttribute(key, new URL(value, doc.baseURI).href); } catch (_) {}
      if (key === 'src') el.removeAttribute('srcset');
    });
    var article = namuRoot ? { title: doc.querySelector('h1')?.textContent || doc.title.replace(/ - 나무위키$/, ''),
      siteName: '나무위키', content: namuRoot.outerHTML, length: namuRoot.textContent.length } : new Readability(clone).parse();
    if (!article || !article.content || (article.length || 0) < (namuRoot ? 80 : 200)) return null;
    return {
      title: article.title || doc.title || '',
      byline: article.byline || null,
      siteName: article.siteName || null,
      content: article.content,
      anchor: anchorInfo,
    };
  } catch (error) { return null; }
})()`;

function restoration(anchor: ReaderAnchor): string {
  return `(function (target) {
    try {
      var BLOCKS = ${JSON.stringify(BLOCKS)};
      var vh = window.innerHeight || 1;
      var norm = function (value) { return (value || '').replace(/\\s+/g, ' ').trim(); };
      var blocks = (${readerBlocks.toString()})(document, ['namu.wiki', 'www.namu.wiki'].includes(location.hostname) && location.pathname.startsWith('/w/'), BLOCKS);
      var el = blocks[target.ordinal];
      var wanted = norm(target.text).slice(0, 40);
      if (wanted && !(el && norm(el.textContent).indexOf(wanted) >= 0)) {
        el = blocks.find(function (b) { return norm(b.textContent).indexOf(wanted) === 0; })
          || blocks.find(function (b) { return norm(b.textContent).indexOf(wanted) >= 0; }) || el;
      }
      if (el) {
        var top = el.getBoundingClientRect().top + window.scrollY - target.yRatio * vh;
        window.scrollTo(0, Math.max(0, top));
        return true;
      }
      var max = Math.max(0, document.documentElement.scrollHeight - vh);
      window.scrollTo(0, target.scrollRatio * max);
      return false;
    } catch (error) { return false; }
  })(${JSON.stringify(anchor)})`;
}

function bounded<T>(task: Promise<T>, fallback: T, timeout = 10_000): Promise<T> {
  return Promise.race([
    task.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), timeout)),
  ]);
}

/** Run Readability over a clone of the live page. The page itself is not
 * mutated, navigated, or reloaded; returning from reader mode is instant. */
export async function extractReaderArticle(contents: WebContents): Promise<ReaderSnapshot | null> {
  const source = await readabilitySource().catch(() => null);
  if (!source || contents.isDestroyed()) return null;
  const url = contents.getURL();
  const raw = await bounded(contents.mainFrame.executeJavaScript(`${source}\n;${extraction}`), null);
  return readReaderSnapshot(raw, url);
}

/** Scroll the (still hidden) live page to the block that was under the
 * reader's double-click point, at the same viewport height. */
export async function restoreReaderAnchor(contents: WebContents, anchor: ReaderAnchor): Promise<boolean> {
  if (contents.isDestroyed()) return false;
  return bounded<boolean>(contents.mainFrame.executeJavaScript(restoration(anchor)).then(value => value === true), false, 5_000);
}
