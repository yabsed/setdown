/**
 * Paper rules written after File Viewer's own print rules, for what those leave to the default
 * sheet (class names as of File Viewer 3.3.3):
 *
 * - a slide deck gets no paper at all, so slides are poured onto A4 and cut where it ends;
 * - legacy Word and Hangul text is one long column whose page margins exist only before the
 *   first line and after the last, so every further sheet starts at its very edge.
 *
 * Paged DOCX already carries its own sheets and needs nothing here.
 */
const px = (value: string | null | undefined) => { const number = Number.parseFloat(value ?? ''); return Number.isFinite(number) && number > 0 ? number : 0; };
const round = (value: number) => Math.round(value * 100) / 100;
const WHOLE = 'html, body, .viewer-export-shell, .viewer-export-content';

/** One sheet per slide, exactly the slide's size. */
function slides(selector: string, width: number, height: number, extra: string): string {
  const w = round(width), h = round(height);
  return `
@page { size: ${w}px ${h}px; margin: 0; }
${WHOLE} { width: ${w}px !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
${selector} { box-sizing: border-box !important; width: ${w}px !important; height: ${h}px !important; min-height: 0 !important; margin: 0 !important;
  overflow: hidden !important; box-shadow: none !important; break-inside: avoid; break-after: page; }
${selector}:last-child { break-after: auto; }
${extra}`;
}

/** A flowing text whose page margins move from the column's padding to every sheet. */
function column(width: number, height: number, margin: { top: number; right: number; bottom: number; left: number }, extra: string): string {
  return `
@page { size: ${round(width)}px ${round(height)}px; margin: ${round(margin.top)}px ${round(margin.right)}px ${round(margin.bottom)}px ${round(margin.left)}px; }
${WHOLE} { width: auto !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
${extra}`;
}

/** Adds the paper rules for the printable document File Viewer has just built in `document`. */
export function layOutPaper(document: Document): void {
  const css = paperStyle(document);
  if (!css) return;
  const style = document.createElement('style');
  style.dataset.setdownPaper = '';
  style.textContent = css;
  // After the viewer's own print rules, which end the body.
  document.body.append(style);
}

function paperStyle(document: Document): string {
  const view = document.defaultView;
  const content = document.querySelector('.viewer-export-content');
  if (!view || !content) return '';

  const slide = content.querySelector<HTMLElement>('.flyfish-pptx-slide-slot > .slide');
  if (slide) {
    const width = px(slide.style.width) || slide.offsetWidth, height = px(slide.style.height) || slide.offsetHeight;
    if (!width || !height) return '';
    // The viewer's export sheet turns every `.content` element into an unplaced full-width block, and a
    // slide's text boxes carry that class: each keeps the place and size the slide gave it.
    for (const box of content.querySelectorAll<HTMLElement>('.slide .content')) {
      for (const property of ['top', 'left', 'width', 'height']) {
        const value = box.style.getPropertyValue(property);
        if (value) box.style.setProperty(property, value, 'important');
      }
      box.style.setProperty('position', 'absolute', 'important');
    }
    return slides('.viewer-export-content .flyfish-pptx-slide-slot', width, height, `
.viewer-export-content .pptx-viewer-shell, .viewer-export-content .pptx-render-surface { min-height: 0 !important; padding: 0 !important; background: #fff !important; }
.viewer-export-content .flyfish-pptx-scale-box, .viewer-export-content .flyfish-pptx-content { position: static !important; width: auto !important;
  height: auto !important; max-width: none !important; margin: 0 !important; transform: none !important; }
.viewer-export-content .flyfish-pptx-content .slide { margin: 0 !important; box-shadow: none !important; }`);
  }

  const picture = content.querySelector<HTMLImageElement>('.ppt-binary-page > img');
  if (picture) {
    // A legacy deck arrives as one picture per slide. Its pixels say the shape, not the size: 7.5in tall as PowerPoint's own slides.
    if (!picture.naturalWidth || !picture.naturalHeight) return '';
    const height = 720, width = height * picture.naturalWidth / picture.naturalHeight;
    return slides('.viewer-export-content .ppt-binary-page', width, height, `
.viewer-export-content .ppt-binary-shell, .viewer-export-content .ppt-binary-slides { width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; gap: 0 !important; background: #fff !important; }
.viewer-export-content .ppt-binary-page > img { display: block !important; width: 100% !important; height: 100% !important; max-width: none !important; }`);
  }

  const legacy = content.querySelector<HTMLElement>('.msdoc-page > .msdoc-root');
  if (legacy) {
    const page = legacy.parentElement!, style = view.getComputedStyle(legacy);
    const width = px(page.style.getPropertyValue('--viewer-print-page-width')) || 794, height = px(page.style.getPropertyValue('--viewer-print-page-height')) || 1123;
    return column(width, height, { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) }, `
.viewer-export-content .msdoc-stage { display: block !important; gap: 0 !important; }
.viewer-export-content .msdoc-page { width: auto !important; min-height: 0 !important; margin: 0 !important; }
.viewer-export-content .msdoc-page > .msdoc-root { width: auto !important; min-height: 0 !important; padding: 0 !important; }`);
  }

  const hangul = content.querySelector<HTMLElement>('.hangul-page');
  if (hangul) {
    const style = view.getComputedStyle(hangul);
    const margin = { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
    const width = px(hangul.style.width) || 793.7067, height = px(hangul.style.minHeight) || 1122.5067;
    // Placed pictures are measured from the sheet's corner, which now lies in the page margin. The viewer's
    // narrow-screen rule, which a sheet's text column also matches, would otherwise drop them into the text.
    for (const media of content.querySelectorAll<HTMLElement>('.hangul-page-media--positioned')) {
      const placed = { position: 'absolute', left: `${round(px(media.style.left) - margin.left)}px`, top: `${round(px(media.style.top) - margin.top)}px`,
        width: media.style.width || 'auto', height: media.style.height || 'auto', margin: '0' };
      for (const [property, value] of Object.entries(placed)) media.style.setProperty(property, value, 'important');
    }
    return column(width, height, margin, `
.viewer-export-content .file-render { height: auto !important; }
.viewer-export-content .hangul-viewer { height: auto !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
.viewer-export-content .hangul-shell { width: auto !important; margin: 0 !important; }
.viewer-export-content .hangul-page { width: auto !important; max-width: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
  overflow: visible !important; box-shadow: none !important; break-after: page; }
.viewer-export-content .hangul-page:last-child { break-after: auto; }
`);
  }
  return '';
}
