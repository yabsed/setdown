# Language tools on real projects

Run 2026-11-19T11:47:12.656Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TypeScript | sindresorhus/p-queue | typescript-language-server | yes (0.2 s) | yes, 5.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s |
| JavaScript | expressjs/express | typescript-language-server | yes (0.2 s) | yes, 5.3 s | yes, 2.3 s | yes (2 of 2), 0.1 s | yes, 0.2 s | yes (2 of 2), 1.3 s |
| Svelte | sveltejs/realworld | svelte-language-server | yes (2.4 s) | yes, 4.8 s | yes, 1.4 s | yes (2 of 2), 1.5 s | yes, 1.5 s | yes, 1.6 s |
| Svelte, a page | sveltejs/realworld | svelte-language-server | yes (0.5 s) | yes, 4.5 s | yes, 1.2 s | yes (2 of 2), 1.3 s | – | yes, 1.3 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### TypeScript: `source/index.ts` in sindresorhus/p-queue@7f272ab5ff

TypeScript and JavaScript, included.

- clean: no error
- mistake `const setdownMistake: number = 'three';`: error: Type 'string' is not assignable to type 'number'.; error: 'setdownMistake' is declared but its value is never read.
- hover `enqueue`: ```typescript (property) enqueue: (run: RunFunction, options?: Partial<EnqueueOptionsType> | undefined) => void ```
- hover `AbortSignal, callback`: ```typescript interface AbortSignal ``` The **`AbortSignal`** interface represents a signal object that allows you to communicate with an asynchronous operatio…
- completion `this.#queue.deq|`: 6 offered, first: dequeue, enqueue, filter, remove, setPriority, size
- definition `PriorityQueue from './priority-queue.js'`: source/priority-queue.ts:11
- definition `enqueue`: source/queue.ts:7

### JavaScript: `lib/application.js` in expressjs/express@43fca52d28

TypeScript and JavaScript, included.

- clean: no error
- mistake `var = ;`: error: Variable declaration expected.
- hover `finalhandler(req, res, {`: ```typescript import finalhandler ``` Module dependencies. *@private*
- hover `compileETag(val)`: ```typescript import compileETag ```
- completion `this.router.rou|`: 114 offered, first: _locals, all, app, apply, arg, args
- definition `compileETag(val)`: lib/utils.js:130
- definition `finalhandler(req, res, {`: lib/application.js:16

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
