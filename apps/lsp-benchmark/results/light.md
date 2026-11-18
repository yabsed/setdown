# Language tools on real projects

Run 2026-11-18T18:49:46.727Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TypeScript | sindresorhus/p-queue | typescript-language-server | yes (0.3 s) | yes, 63.4 s | yes, 2.2 s | NO (1 of 2) | yes, 2.2 s | yes (2 of 2), 2.3 s |
| JSON | sindresorhus/p-queue | json-lsp | yes (0.7 s) | yes, 63.7 s | yes, 1.6 s | NO | yes, 1.6 s | – |
| JSON with comments | sindresorhus/p-queue | json-lsp | yes (0.3 s) | yes, 3.6 s | yes, 0.6 s | yes, 0.6 s | yes, 0.6 s | – |
| YAML | spf13/cobra | yaml-language-server | yes (0.5 s) | yes, 4.4 s | yes, 1.0 s | yes, 1.4 s | – | – |
| YAML, a GitHub workflow | sindresorhus/p-queue | yaml-language-server | yes (0.4 s) | yes, 5.7 s | yes, 2.7 s | yes, 1.7 s | yes, 1.7 s | – |
| Dockerfile | docker/awesome-compose | dockerfile-language-server | yes (2.0 s) | yes, 3.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | – |
| Docker Compose | docker/awesome-compose | docker-compose-language-service | yes (0.3 s) | unknown | NO | yes (2 of 2), 0.0 s | NO | – |
| CSS | picocss/pico | css-lsp | yes (0.4 s) | yes, 3.1 s | yes, 0.1 s | yes, 0.1 s | yes, 0.1 s | – |
| SCSS | picocss/pico | css-lsp | yes (0.3 s) | yes, 3.1 s | yes, 0.0 s | yes, 0.0 s | yes, 0.1 s | – |
| Less | twbs/bootstrap | css-lsp | yes (0.3 s) | yes, 3.1 s | yes, 0.0 s | yes, 0.0 s | yes, 0.1 s | – |
| HTML | h5bp/html5-boilerplate | html-lsp | yes (3.0 s) | yes, 3.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s | – |

4 expectations were not met: typescript: hover at enqueue; json: hover at "engines"; dockercompose: mistake; dockercompose: completion at healthch|.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### TypeScript: `source/index.ts` in sindresorhus/p-queue@7f272ab5ff

TypeScript and JavaScript, included.

- clean: no error
- mistake `const setdownMistake: number = 'three';`: error: Type 'string' is not assignable to type 'number'.; error: 'setdownMistake' is declared but its value is never read.
- hover `enqueue` (NOT as expected: text matching /\(method\) Queue<.*enqueue/s): ```typescript (property) enqueue: (run: RunFunction, options?: Partial<EnqueueOptionsType> | undefined) => void ```
- hover `AbortSignal, callback`: ```typescript interface AbortSignal ``` The **`AbortSignal`** interface represents a signal object that allows you to communicate with an asynchronous operatio…
- completion `this.#queue.deq|`: 6 offered, first: dequeue, enqueue, filter, remove, setPriority, size
- definition `PriorityQueue from './priority-queue.js'`: source/priority-queue.ts:11
- definition `enqueue`: source/queue.ts:7

### JSON: `package.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"engines"` (NOT as expected: text matching /\S/): no answer
- completion `"scr|`: 52 offered, first: homepage, bugs, licenses, author, contributors, maintainers

### JSON with comments: `tsconfig.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"outDir"`: If specified, `.js` (as well as `.d.ts`, `.js.map`, etc.) files will be emitted into this directory. The directory structure of the original source files is pr…
- completion `"rootD|`: 121 offered, first: allowArbitraryExtensions, allowImportingTsExtensions, charset, composite, customConditions, declaration

### YAML: `.golangci.yml` in spf13/cobra@adbc881390

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `version: "3"`: error: Map keys must be unique
- hover `timeout: 5m`: #### Golangci-lint Configuration Timeout for the analysis. Example: ```yaml 30s ``` Example: ```yaml 5m ``` Example: ```yaml 5m30s ``` Source: [golangci.jsonsc…

### YAML, a GitHub workflow: `.github/workflows/main.yml` in sindresorhus/p-queue@7f272ab5ff

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `setdown-mistake: 1`: error: Property setdown-mistake is not allowed.
- hover `runs-on`: #### GitHub Workflow The type of machine to run the job on. The machine can be either a GitHub-hosted runner, or a self-hosted runner. Source: [github-workflow…
- completion `runs-|`: 16 offered, first: needs, snapshot, permissions, cache-mode, runs-on, normalJob

### Dockerfile: `nginx-flask-mysql/backend/Dockerfile` in docker/awesome-compose@30f4b7f6a6

dockerfile-language-server, installed by Setdown.

- clean: no error
- mistake `EXPOSE eighty`: error: Invalid containerPort: eighty
- hover `WORKDIR /code`: Set the working directory for any subsequent `ADD`, `COPY`, `CMD`, `ENTRYPOINT`, or `RUN` instructions that follow it in the `Dockerfile`. ``` WORKDIR /path/to…
- hover `EXPOSE 8000`: Define the network `port`s that this container will listen on at runtime. ``` EXPOSE 8080 EXPOSE 80 443 22 EXPOSE 7000-8000 ``` [Online documentation](https://…
- completion `WORKD|`: 1 offered, first: WORKDIR /the/workdir/path

### Docker Compose: `nginx-flask-mysql/compose.yaml` in docker/awesome-compose@30f4b7f6a6

docker-compose-language-service, installed by Setdown.

- clean (unknown): no error, but the tool reported nothing at all
- mistake `setdown_mistake: 1` (NOT as expected: the added line is marked): not marked
- hover `healthcheck:`: A command for checking if the container is healthy
- hover `depends_on:`: Other services that this service depends on, which will be started before this one
- completion `healthch|` (NOT as expected: "healthcheck" offered): nothing offered

### CSS: `css/pico.css` in picocss/pico@a07563ddc8

css-lsp, installed by Setdown.

- clean: no error
- mistake `.setdown-mistake { colr: red; }`: warning: Unknown property: 'colr'
- hover `cursor: pointer`: Allows control over cursor appearance in an element ![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAw…
- completion `cursor: poin|`: 198 offered, first: alias, all-scroll, auto, cell, col-resize, context-menu

### SCSS: `scss/content/_button.scss` in picocss/pico@a07563ddc8

css-lsp, installed by Setdown.

- clean: no error
- mistake `.setdown-mistake { colr: red; }`: warning: Unknown property: 'colr'
- hover `overflow: visible`: Shorthand for setting 'overflow\-x' and 'overflow\-y'\. ![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAg…
- completion `text-transf|`: 1107 offered, first: @extend, @at-root, @debug, @warn, @error, @if

### Less: `less/buttons.less` in twbs/bootstrap@68b0d231a1

css-lsp, installed by Setdown.

- clean: no error
- mistake `.setdown-mistake { colr: red; }`: warning: Unknown property: 'colr'
- hover `white-space: nowrap`: Specifies how whitespace is handled in an element\. ![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAw…
- completion `vertical-al|`: 1099 offered, first: :active, :any-link, :checked, :corner-present, :decrement, :default

### HTML: `src/index.html` in h5bp/html5-boilerplate@7fa0bd6c9e

html-lsp, installed by Setdown.

- clean: no error
- mistake `<style>.setdown-mistake { colr: red; }</style>`: warning: Unknown property: 'colr'
- hover `meta charset`: The meta element represents various kinds of metadata that cannot be expressed using the title, base, link, style, and script elements. ![Baseline icon](data:i…
- completion `<scr|`: 116 offered, first: html, head, title, base, link, meta
