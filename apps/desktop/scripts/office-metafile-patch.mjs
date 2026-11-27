// File Viewer turns an EMF picture into SVG with a converter of its own, which three of its packages
// carry: the PPTX worker, the legacy PowerPoint parser (worker and module) and the legacy Word
// parser. This corrects how that converter builds an outline, and nothing else.
//
// In a GDI path bracket (BeginPath … EndPath) a figure starts where MoveToEx puts the current
// position, and every LineTo, PolylineTo and PolyBezierTo continues it until CloseFigure or the
// next MoveToEx. A logo exported from Illustrator, an EPS or LibreOffice is written that way: move,
// lines, curves, close. The converter started a new SVG sub-path ("M …") for each PolylineTo and
// PolyBezierTo record, so a filled outline was painted as its separate pieces, each closed on its
// own: letters turned into slivers and wedges. LineTo had the opposite fault: after a MoveToEx in
// the middle of a path it kept drawing from the figure before.
//
// The correction keeps one number on the converter's context: the length of the path data right
// after the last "…To" record. A figure is open exactly while that still is the length, so
// CloseFigure and every record that draws a figure of its own (Polygon, Rectangle, Ellipse, …) end
// it without being touched; MoveToEx and BeginPath reset it. An open figure is continued without
// "M"; anything else starts at the current position, as GDI does. (The copy that reads ArcTo started
// a sub-path for it as well; it is continued the same way.)
//
// That position has to be GDI's too. Polyline, Polygon and PolyBezier neither use nor move the
// current position; the converter moved it to their last point, so the next "…To" record started
// from the wrong place. Only the "…To" records move it now.
//
// The packages publish the converter minified (the PPTX worker) and as written (the others), so
// each place is described once per form and found by its shape. A place that is missing or found
// twice throws: an upgraded package must be read again rather than shipped unpatched.

/** The worker scripts that carry the converter; the application loads each by URL. */
export const METAFILE_WORKERS = { pptx: '@file-viewer/pptx/worker/pptx.worker.js', ppt: '@file-viewer/ppt/worker.mjs' };
/** The modules that carry it and are bundled into the application's own chunks, as paths inside their packages. */
export const METAFILE_MODULES = [['@file-viewer/doc', 'dist/msdoc/vector.js'], ['@file-viewer/ppt', 'dist/core/vector.js']];
/** Whether a resolved file is one of those modules. */
export const isMetafileModule = file => /[\\/]@file-viewer[\\/](?:doc[\\/]dist[\\/]msdoc|ppt[\\/]dist[\\/]core)[\\/]vector\.js$/.test(file.split('?')[0]);

const ID = '[A-Za-z_$][\\w$]*';
/** Text of the same function: the minifier writes each helper as a `function` declaration. */
const SAME_FUNCTION = '(?:(?!function )[^])*?';
const MARK = 'setdownFigure';
const open = context => `${context}.${MARK}===${context}.pathData.length`;
const mark = context => `${context}.${MARK}=${context}.pathData.length`;

const MINIFIED = [
  { name: 'BeginPath resets the figure',
    find: new RegExp(`(case ${ID}\\.EMR_BEGINPATH:(${ID})\\.capturePath=!0,\\2\\.pathData=\\[\\],\\2\\.pathPoints=\\[\\];)break;`),
    replace: (_all, head, context) => `${head}${context}.${MARK}=-1;break;` },
  { name: 'MoveToEx starts a new figure',
    find: new RegExp(`(case ${ID}\\.EMR_MOVETOEX:(${ID})\\.state\\.currentPosition=\\{x:${ID}\\.i32\\(8\\),y:${ID}\\.i32\\(12\\)\\};)break;`),
    replace: (_all, head, context) => `${head}${context}.${MARK}=-1;break;` },
  { name: 'LineTo continues an open figure and starts one after MoveToEx',
    find: new RegExp(`(${ID})\\((${ID}),\`\\$\\{\\2\\.pathData\\.length\\?"":\`M \\$\\{(${ID})\\((${ID})\\)\\}\`\\} L \\$\\{\\3\\((${ID})\\)\\}\`\\.trim\\(\\),\\[\\4,\\5\\]\\);return\\}`),
    replace: (_all, append, context, format, from, to) =>
      `${append}(${context},\`\${${open(context)}?"":\`M \${${format}(${from})}\`} L \${${format}(${to})}\`.trim(),[${from},${to}]);${mark(context)};return}` },
  { name: 'PolylineTo says that it continues from the current position',
    find: new RegExp(`(${ID}\\((${ID}),\\[\\{\\.\\.\\.\\2\\.state\\.currentPosition\\},\\.\\.\\.${ID}\\],!1)\\);break\\}`),
    replace: (_all, call) => `${call},!0);break}` },
  { name: 'a polyline that continues an open figure does not start a sub-path',
    find: new RegExp(`(if\\((${ID})\\.capturePath\\)\\{let (${ID})=\\[\`M \\$\\{${ID}\\(${ID}\\[0\\]\\)\\}\`,\\.\\.\\.${ID}\\.slice\\(1\\)\\.map\\(${ID}=>\`L \\$\\{${ID}\\(${ID}\\)\\}\`\\)\\];)(${ID})&&\\3\\.push\\("Z"\\),(${ID})\\(\\2,\\3\\.join\\(" "\\),(${ID})\\);return\\}`),
    replace: (_all, head, context, parts, closed, append, points) =>
      `${head}let setdownTo=arguments[3]===!0;setdownTo&&${open(context)}&&${parts}.shift();${closed}&&${parts}.push("Z"),${append}(${context},${parts}.join(" "),${points});setdownTo&&(${mark(context)});return}` },
  { name: 'Polyline and Polygon do not move the current position',
    find: new RegExp(`(${ID})\\.state\\.currentPosition=\\{\\.\\.\\.(${ID})\\[\\2\\.length-1\\]\\};(let ${ID}=${ID}\\.map\\(${ID}\\)\\.join\\(" "\\);)`),
    replace: (_all, context, points, rest) => `arguments[3]===!0&&(${context}.state.currentPosition={...${points}[${points}.length-1]});${rest}` },
  { name: 'PolyBezier does not move the current position',
    find: new RegExp(`(function ${ID}\\((${ID}),${ID},(${ID})=!1\\)\\{${SAME_FUNCTION}if\\()(\\2\\.state\\.currentPosition=\\{\\.\\.\\.(${ID})\\[\\5\\.length-1\\]\\}),(\\2\\.capturePath\\)\\{)`),
    replace: (_all, head, _context, to, move, _points, rest) => `${head}${to}&&(${move}),${rest}` },
  { name: 'a PolyBezierTo that continues an open figure does not start a sub-path',
    find: new RegExp(`(function ${ID}\\((${ID}),${ID},(${ID})=!1\\)\\{${SAME_FUNCTION},(${ID})=\`M \\$\\{${SAME_FUNCTION}\\2\\.capturePath\\)\\{)(${ID})\\(\\2,\\4,(${ID})\\);return\\}`),
    replace: (_all, head, context, to, data, append, points) =>
      `${head}${to}&&${open(context)}&&(${data}=${data}.slice(${data}.indexOf(" C ")+1));${append}(${context},${data},${points});${to}&&(${mark(context)});return}` },
];

// The same places as the packages' own build writes them. Every addition stays on a line that
// is already there, so the source map of the bundle that takes the module still names the right lines.
const NAME = name => `${name}[\\w$]*`;
const WRITTEN = [
  { name: 'BeginPath resets the figure',
    find: new RegExp(`(case EMF_RECORD\\.EMR_BEGINPATH:\\s*ctx\\.capturePath = true;)`),
    replace: (_all, head) => `${head} ctx.${MARK} = -1;` },
  { name: 'MoveToEx starts a new figure',
    find: new RegExp(`(case EMF_RECORD\\.EMR_MOVETOEX:\\s*ctx\\.state\\.currentPosition = \\{ x: record\\.i32\\(8\\), y: record\\.i32\\(12\\) \\};)`),
    replace: (_all, head) => `${head} ctx.${MARK} = -1;` },
  { name: 'LineTo continues an open figure and starts one after MoveToEx',
    find: new RegExp(`(${NAME('addPathFragment')})\\(ctx, \`\\$\\{ctx\\.pathData\\.length \\? '' : \`M \\$\\{(${NAME('pointAttr')})\\(a\\)\\}\`\\} L \\$\\{\\2\\(b\\)\\}\`\\.trim\\(\\), \\[a, b\\]\\);(\\s*)return;`),
    replace: (_all, append, format, gap) =>
      `${append}(ctx, \`\${${open('ctx')} ? '' : \`M \${${format}(a)}\`} L \${${format}(b)}\`.trim(), [a, b]); ${mark('ctx')};${gap}return;` },
  { name: 'PolylineTo says that it continues from the current position',
    find: new RegExp(`(${NAME('addPolyline')}\\(ctx, \\[\\{ \\.\\.\\.ctx\\.state\\.currentPosition \\}, \\.\\.\\.points\\], false)\\);`),
    replace: (_all, call) => `${call}, true);` },
  { name: 'a polyline that continues an open figure does not start a sub-path',
    find: new RegExp(`(const commands = \\[\`M \\$\\{${NAME('pointAttr')}\\(mapped\\[0\\]\\)\\}\`, \\.\\.\\.mapped\\.slice\\(1\\)\\.map\\(\\(point\\) => \`L \\$\\{${NAME('pointAttr')}\\(point\\)\\}\`\\)\\];)(\\s*)(if \\(closed\\)\\s*commands\\.push\\('Z'\\);\\s*${NAME('addPathFragment')}\\(ctx, commands\\.join\\(' '\\), mapped\\);)\\s*return;`),
    replace: (_all, head, gap, rest) =>
      `${head} const setdownTo = arguments[3] === true; if (setdownTo && ${open('ctx')}) commands.shift();${gap}${rest} if (setdownTo) ${mark('ctx')};${gap}return;` },
  { name: 'Polyline and Polygon do not move the current position',
    find: new RegExp(`(ctx\\.state\\.currentPosition = \\{ \\.\\.\\.points\\[points\\.length - 1\\] \\};)`),
    replace: (_all, move) => `if (arguments[3] === true) ${move}` },
  { name: 'PolyBezier does not move the current position',
    find: new RegExp(`(ctx\\.state\\.currentPosition = \\{ \\.\\.\\.logical\\[logical\\.length - 1\\] \\};)`),
    replace: (_all, move) => `if (relativeToCurrent) ${move}` },
  { name: 'a PolyBezierTo that continues an open figure does not start a sub-path',
    find: new RegExp(`(if \\(ctx\\.capturePath\\) \\{)(\\s*)(${NAME('addPathFragment')}\\(ctx, path, mapped\\);)\\s*return;`),
    replace: (_all, head, gap, append) =>
      `${head} if (relativeToCurrent && ${open('ctx')}) path = path.slice(path.indexOf(' C ') + 1);${gap}${append} if (relativeToCurrent) ${mark('ctx')};${gap}return;` },
];

// The legacy PowerPoint converter also reads the arc records. ArcTo is a "…To" record like the others:
// a line from the current position to the arc's start, then the arc.
const ARC_TO = { name: 'an ArcTo that continues an open figure does not start a sub-path',
  find: new RegExp(`(if \\(ctx\\.capturePath\\))(\\s*)(${NAME('addPathFragment')}\\(ctx, path, points\\);)(\\s*else\\s*${NAME('addNode')}\\(ctx, \`<path d="\\$\\{path\\}" \\$\\{kind === 'arc' \\|\\| kind === 'arcTo')`),
  replace: (_all, head, gap, append, rest) =>
    `${head} {${gap}if (kind === 'arcTo' && ${open('ctx')}) path = path.slice(path.indexOf(' L') + 1); ${append} if (kind === 'arcTo') ${mark('ctx')}; }${rest}` };

/** The converter with EMF outlines built as GDI builds them. Throws when the source is not one this was written for. */
export function patchMetafileOutlines(source) {
  const places = !/function addBezierPath[\w$]*\(ctx, points, relativeToCurrent = false\)/.test(source) ? MINIFIED
    : source.includes("kind === 'arcTo'") ? [...WRITTEN, ARC_TO] : WRITTEN;
  let patched = source;
  for (const place of places) {
    const found = patched.match(new RegExp(place.find.source, 'g'))?.length ?? 0;
    if (found !== 1) throw Error(`The EMF converter cannot be patched: "${place.name}" was found ${found} times, not once.`);
    patched = patched.replace(place.find, place.replace);
  }
  return patched;
}
