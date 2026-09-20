import { randomUUID } from 'node:crypto';
import type { MarkdownItLike } from './source-anchors';

export function encodeMathAttribute(html: string): string {
  return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One serialized render owns its placeholders, including block math.
 * Only normal, untrusted-mode KaTeX output may bypass generic HTML enhancers.
 * Error strings, HTML-enabled math and raw HTML take the original sanitizer path.
 */
export class DeferredMath {
  private readonly installed = new WeakSet<object>();
  private values: string[] = [];
  private nonce = '';
  private marker = /$^/g;
  private encodedMarker = /$^/g;

  reset(): void {
    this.values = [];
    this.nonce = randomUUID();
    this.marker = new RegExp(`<span data-marktex-math="${this.nonce}:(\\d+)"></span>`, 'g');
    this.encodedMarker = new RegExp(`&lt;span data-marktex-math=&quot;${this.nonce}:(\\d+)&quot;&gt;&lt;/span&gt;`, 'g');
  }

  install(md: MarkdownItLike, allowed: () => boolean): void {
    if (this.installed.has(md)) return;
    this.installed.add(md);
    for (const name of ['math', 'math_block']) {
      const original = md.renderer.rules[name];
      if (!original) continue;
      md.renderer.rules[name] = (tokens, index, options, env, self) => {
        const html = original(tokens, index, options, env, self);
        // parseMath's error path can contain unsanitized source. Do not defer it.
        if (!this.nonce || !allowed() || !/^<span class="katex(?:-display)?">/.test(html)) return html;
        const slot = this.values.push(html) - 1;
        return `<span data-marktex-math="${this.nonce}:${slot}"></span>`;
      };
    }
  }

  restore(html: string): string {
    if (!this.values.length) return html;
    return html.replace(this.marker, (whole, slot: string) => this.values[Number(slot)] ?? whole);
  }

  restoreTemplate(template: string): string {
    if (!this.values.length) return template;
    const encoded: string[] = [];
    return template.replace(this.encodedMarker, (whole, slot: string) => {
      const index = Number(slot);
      const source = this.values[index];
      if (source === undefined) return whole;
      return encoded[index] ??= encodeMathAttribute(source);
    });
  }
}
