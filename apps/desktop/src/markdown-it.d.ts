declare module 'markdown-it' {
  export default class MarkdownIt {
    constructor(options?: { html?: boolean });
    render(source: string, env?: object): string;
    parse(source: string, env: object): unknown[];
  }
}
