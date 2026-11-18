# Language tools on real projects

Run 2026-11-18T19:06:48.942Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Svelte | sveltejs/realworld | svelte-language-server | yes (4.1 s) | yes, 4.7 s | yes, 1.4 s | yes (2 of 2), 1.4 s | yes, 1.5 s | yes, 1.5 s |
| Svelte, a page | sveltejs/realworld | svelte-language-server | yes (0.5 s) | yes, 4.5 s | yes, 1.3 s | yes (2 of 2), 1.3 s | – | yes, 1.3 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Svelte: `src/lib/ArticleList/ArticlePreview.svelte` in sveltejs/realworld@df79670804

svelte-language-server, installed by Setdown.

- clean: no error
- mistake `<img src="setdown-mistake.png">`: warning: `<img>` element should have an alt attribute
- hover `enhance } from '$app/forms'`: ```typescript (alias) function enhance<Success extends Record<string, unknown> | undefined, Failure extends Record<string, unknown> | undefined>(form_element: …
- hover `type`: ```typescript (property) type: "success" | "redirect" | "error" | "failure" ```
- completion `result.ty|`: 54 offered, first: data?, error, location, status?, type, __sveltets_$$bindings
- definition `enhance } from '$app/forms'`: node_modules/@sveltejs/kit/src/runtime/app/forms.js:80

### Svelte, a page: `src/routes/article/[slug]/+page.svelte` in sveltejs/realworld@df79670804

svelte-language-server, installed by Setdown.

- clean: no error
- mistake `<img src="setdown-mistake.png">`: warning: `<img>` element should have an alt attribute
- hover `ArticleMeta`: ```typescript (alias) const ArticleMeta: Component<$$ComponentProps, {}, ""> import ArticleMeta ```
- hover `data.article.title}</title>`: ```typescript const data: { user: any; article: any; comments: any; } ```
- definition `CommentContainer`: src/routes/article/[slug]/CommentContainer.svelte:1
