# Language tools on real projects

Run 2026-11-18T19:06:00.357Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Python | pallets/flask | pyright | yes (0.4 s) | yes, 5.0 s | yes, 2.0 s | yes (2 of 2), 1.0 s | yes, 1.0 s | yes (2 of 2), 1.0 s |
| TypeScript | sindresorhus/p-queue | typescript-language-server | yes (0.2 s) | yes, 5.3 s | yes, 2.3 s | yes (2 of 2), 1.3 s | yes, 1.3 s | yes (2 of 2), 1.3 s |
| Svelte | sveltejs/realworld | svelte-language-server | yes (3.7 s) | unknown | NO | NO (1 of 2) | NO | yes, 1.6 s |
| Svelte, a page | sveltejs/realworld | svelte-language-server | yes (0.5 s) | unknown | NO | yes (2 of 2), 1.3 s | – | yes, 1.3 s |
| C++ | fmtlib/fmt | clangd | yes (0.1 s) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s |
| Go module file | spf13/cobra | gopls | yes (0.1 s) | yes, 3.0 s | – | yes, 0.0 s | – | – |
| JSON | sindresorhus/p-queue | json-lsp | yes (0.4 s) | yes, 4.1 s | yes, 1.1 s | yes, 1.1 s | yes, 1.1 s | – |
| Docker Compose | docker/awesome-compose | yaml-language-server | yes (0.4 s) | yes, 10.2 s | yes, 7.2 s | yes (2 of 2), 6.2 s | yes, 6.2 s | – |

4 expectations were not met: svelte: mistake; svelte: hover at querySelector; svelte: completion at form.querySel|; svelte-page: mistake.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Python: `src/flask/app.py` in pallets/flask@49943b5a94

Pyright, included.

- clean: no error; line 1363 accepted: Pyright does not take a bytearray where werkzeug declares bytes; flask is checked with mypy, which does
- mistake `setdown_mistake: int = "three"`: error: Type "Literal['three']" is not assignable to declared type "int"
- hover `MapAdapter | None:`: ```python class MapAdapter( map: Map, server_name: str, script_name: str, subdomain: str | None, url_scheme: str, path_info: str, default_method: str, query_ar…
- hover `get_debug_flag()`: ```python (function) def get_debug_flag() -> bool ``` --- Get whether debug mode should be enabled for the app, indicated by the `FLASK_DEBUG` environment vari…
- completion `self.url_map.bind_to_env|`: 1 offered, first: bind_to_environ
- definition `get_debug_flag()`: src/flask/helpers.py:28
- definition `MapAdapter | None:`: .venv/lib/python3.13/site-packages/werkzeug/routing/map.py:382

### TypeScript: `source/index.ts` in sindresorhus/p-queue@7f272ab5ff

TypeScript and JavaScript, included.

- clean: no error
- mistake `const setdownMistake: number = 'three';`: error: Type 'string' is not assignable to type 'number'.; error: 'setdownMistake' is declared but its value is never read.
- hover `enqueue`: ```typescript (property) enqueue: (run: RunFunction, options?: Partial<EnqueueOptionsType> | undefined) => void ```
- hover `AbortSignal, callback`: ```typescript interface AbortSignal ``` The **`AbortSignal`** interface represents a signal object that allows you to communicate with an asynchronous operatio…
- completion `this.#queue.deq|`: 6 offered, first: dequeue, enqueue, filter, remove, setPriority, size
- definition `PriorityQueue from './priority-queue.js'`: source/priority-queue.ts:11
- definition `enqueue`: source/queue.ts:7

### Svelte: `src/lib/ArticleList/ArticlePreview.svelte` in sveltejs/realworld@df79670804

svelte-language-server, installed by Setdown.

- clean (unknown): no error, but the tool reported nothing at all
- mistake `<p>{setdownMistake}</p>` (NOT as expected: the added line is marked): not marked
- hover `enhance } from '$app/forms'`: ```typescript (alias) function enhance<Success extends Record<string, unknown> | undefined, Failure extends Record<string, unknown> | undefined>(form_element: …
- hover `querySelector` (NOT as expected: text matching /querySelector/): ```typescript any ```
- completion `form.querySel|` (NOT as expected: "querySelector" offered): 50 offered, first: __sveltets_$$bindings, __sveltets_2_ensureAction, __sveltets_2_ensureArray, __sveltets_2_fn_component, __sveltets_2_union, $$action_0
- definition `enhance } from '$app/forms'`: node_modules/@sveltejs/kit/src/runtime/app/forms.js:80

### Svelte, a page: `src/routes/article/[slug]/+page.svelte` in sveltejs/realworld@df79670804

svelte-language-server, installed by Setdown.

- clean (unknown): no error, but the tool reported nothing at all
- mistake `<p>{setdownMistake}</p>` (NOT as expected: the added line is marked): not marked
- hover `ArticleMeta`: ```typescript (alias) const ArticleMeta: Component<$$ComponentProps, {}, ""> import ArticleMeta ```
- hover `data.article.title}</title>`: ```typescript const data: { user: any; article: any; comments: any; } ```
- definition `CommentContainer`: src/routes/article/[slug]/CommentContainer.svelte:1

### C++: `src/os.cc` in fmtlib/fmt@14ac0d5a9d

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake() { return missing_name; }`: error: Use of undeclared identifier 'missing_name'; hint: Use a trailing return type for this function (fix available)
- hover `error_code`: ### class `error_code` provided by `<system_error>` --- @addtogroup diagnostics @{ --- ```cpp // In namespace std class error_code {} ```
- hover `close`: ### instance-method `buffered_file::close` provided by `"fmt/os.h"` --- → `void` Closes the file. --- ```cpp // In buffered_file public: void buffered_file::cl…
- completion `std::generic_cat|`: 1 offered, first: •generic_category
- definition `close`: include/fmt/os.h:201

### Go module file: `go.mod` in spf13/cobra@adbc881390

gopls, installed by Setdown.

- clean: no error
- hover `github.com/spf13/pflag`: #### github.com/spf13/pflag This module is necessary because [github.com/spf13/pflag](https://pkg.go.dev/github.com/spf13/pflag@v1.0.9) is imported in `github.…

### JSON: `package.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"scripts"`: The 'scripts' member is an object hash of script commands that are run at various times in the lifecycle of your package\. The key is the lifecycle event, and …
- completion `"scr|`: 52 offered, first: homepage, bugs, licenses, author, contributors, maintainers

### Docker Compose: `nginx-flask-mysql/compose.yaml` in docker/awesome-compose@30f4b7f6a6

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `setdown_mistake: 1`: error: Property setdown_mistake is not allowed.
- hover `healthcheck:`: #### docker-compose.yml Configure a health check for the container to monitor its health status. Source: [compose-spec.json](https://raw.githubusercontent.com/…
- hover `depends_on:`: #### docker-compose.yml Express dependency between services. Service dependencies cause services to be started in dependency order. The dependent service will …
- completion `healthch|`: 86 offered, first: annotations, blkio_config, cap_add, cap_drop, cgroup, cgroup_parent
