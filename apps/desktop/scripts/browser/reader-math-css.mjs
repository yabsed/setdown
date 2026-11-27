/**
 * KaTeX's style sheet with every font inside it: each `@font-face` keeps only its WOFF2 file,
 * as a data: address. The reader's PDF export page has no address to load fonts from.
 */
export function readerMathCss(css, readFont) {
  let faces = 0;
  const embedded = css.replace(/src:url\(fonts\/([\w-]+\.woff2)\) format\("woff2"\)(?:,url\([^)]*\) format\("[^"]*"\))*/g, (_whole, file) => {
    faces++;
    return `src:url(data:font/woff2;base64,${Buffer.from(readFont(file)).toString('base64')}) format("woff2")`;
  });
  // A KaTeX release that words its font faces differently must fail the build, not ship formulas in a fallback font.
  if (!faces || /url\((?!data:)/.test(embedded)) throw new Error('KaTeX font faces were not all embedded.');
  return embedded;
}
