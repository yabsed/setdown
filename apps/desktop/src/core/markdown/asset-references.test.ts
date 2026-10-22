import { expect, test } from 'vitest';
import { rewriteAssetReferences } from './asset-references';

const relocation = { sourceDirectoryName: 'Untitled 2.assets', destinationDirectoryName: '한글 #1.assets' };
const rewrite = (text: string) => rewriteAssetReferences(text, relocation);
const target = '%ED%95%9C%EA%B8%80%20%231.assets';

test('rewrites inline links, reference definitions and nested Markdown without reserializing prose', () => {
  const input = '> - ![a [label]](<Untitled 2.assets/a.png> "title")\r\n\r\n[image]: Untitled%202.assets/b.png "same title"\r\n![ref][image]';
  expect(rewrite(input)).toBe(`> - ![a [label]](<${target}/a.png> "title")\r\n\r\n[image]: ${target}/b.png "same title"\r\n![ref][image]`);
});

test('keeps code, prose, external URLs, incomplete links and other relative directories intact', () => {
  const input = [
    'Untitled 2.assets/a.png', '`![x](Untitled%202.assets/a.png)`',
    '```md', '![x](Untitled%202.assets/a.png)', '```', '',
    '    ![x](Untitled%202.assets/a.png)', '',
    '![x](https://example.test/Untitled%202.assets/a.png)',
    '![x](other/Untitled%202.assets/a.png)', '![x](Untitled%202.assets/../unrelated.png)',
    '![incomplete](Untitled%202.assets/a.png',
  ].join('\n');
  expect(rewrite(input)).toBe(input);
});

test('rewrites actual HTML attributes but preserves comments, scripts, labels and text', () => {
  const input = '<img alt="Untitled 2.assets/a.png" src="Untitled%202.assets/a.png?width=1&amp;size=2">\n'
    + '<!-- <img src="Untitled%202.assets/a.png"> -->\n<script>const x = "Untitled 2.assets/a.png"</script>';
  expect(rewrite(input)).toBe(input.replace('src="Untitled%202.assets/a.png?width', `src="${target}/a.png?width`));
});

test('preserves escaped parentheses and URI fragments in actual destinations', () => {
  expect(rewrite('![x](Untitled%202.assets/a\\(1\\).png#part)'))
    .toBe(`![x](${target}/a%281%29.png#part)`);
});
