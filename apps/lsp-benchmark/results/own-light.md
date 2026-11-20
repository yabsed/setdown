# Language tools on real projects

Run 2026-11-20T14:00:29.827Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Svelte | sveltejs/realworld | svelte-language-server | yes (2.3 s) | yes, 4.9 s | yes, 1.5 s | yes (2 of 2), 1.5 s | yes, 1.6 s | yes, 1.6 s | – | yes (3 of 3), 1.6 s |
| C++ | fmtlib/fmt | clangd | yes (0.1 s) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s |
| PHP | nikic/FastRoute | intelephense | yes (2.0 s) | yes, 3.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | – | yes, 0.0 s |
| JSON | sindresorhus/p-queue | json-lsp | yes (1.9 s) | yes, 4.1 s | yes, 1.1 s | yes, 0.1 s | yes, 0.1 s | – | – | yes, 0.1 s |
| YAML, a GitHub workflow | sindresorhus/p-queue | yaml-language-server | yes (2.1 s) | yes, 4.2 s | yes, 1.2 s | yes, 0.2 s | yes, 0.2 s | – | – | yes (2 of 2), 0.2 s |
| CSS | picocss/pico | css-lsp | yes (1.7 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – | – | – |
| HTML | h5bp/html5-boilerplate | html-lsp | yes (3.2 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – | – | yes, 0.0 s |

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
- own `$/getCompiledCode`: {"js":{"code":"import 'svelte/internal/disclose-version';\nimport * as $ from 'svelte/internal/client';\nimport { enhance } from '$app/forms';\n\nvar root = $.…
- own `$/getComponentReferences`: [{"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/realworld/src/lib/ArticleList/index.svelte",…
- own `$/getFileReferences`: [{"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/realworld/src/lib/ArticleList/index.svelte",…

### C++: `src/os.cc` in fmtlib/fmt@14ac0d5a9d

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake() { return missing_name; }`: error: Use of undeclared identifier 'missing_name'; hint: Use a trailing return type for this function (fix available)
- hover `error_code`: ### class `error_code` provided by `<system_error>` --- @addtogroup diagnostics @{ --- ```cpp // In namespace std class error_code {} ```
- hover `close`: ### instance-method `buffered_file::close` provided by `"fmt/os.h"` --- → `void` Closes the file. --- ```cpp // In buffered_file public: void buffered_file::cl…
- completion `std::generic_cat|`: 1 offered, first: •generic_category
- faded `#    define S_IRUSR _S_IREAD`: 16 regions left out: lines 10-10, 22-22, 28-31, 36-38, 43-60, 65-121, 135-167, 193-199
- definition `close`: include/fmt/os.h:201
- own `textDocument/switchSourceHeader`: file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/fmt/include/fmt/os.h

### PHP: `src/RouteCollector.php` in nikic/FastRoute@1c961398be

intelephense, installed by Setdown.

- clean: no error
- mistake `function setdown_mistake(): void { echo missing_function(); }`: error: Undefined function 'FastRoute\missing_function'.
- hover `parse`: __FastRoute\\RouteParser::parse__ Parses a route string into multiple route data arrays. ```php <?php public function parse(string $route): array { } ``` The e…
- hover `ConfigureRoutes`: __FastRoute\\ConfigureRoutes__ ```php <?php interface ConfigureRoutes { } ```
- completion `$this->dataGenerator->addRou|`: 1 offered, first: addRoute
- definition `parse`: src/RouteParser.php:41
- definition `ConfigureRoutes`: src/ConfigureRoutes.php:13
- own `cancel indexing`: null

### JSON: `package.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"scripts"`: The 'scripts' member is an object hash of script commands that are run at various times in the lifecycle of your package\. The key is the lifecycle event, and …
- completion `"scr|`: 48 offered, first: homepage, bugs, licenses, author, contributors, maintainers
- own `the edits that sort the document`: [{"range":{"start":{"line":0,"character":0},"end":{"line":83,"character":0}},"newText":"{\n\t\"description\": \"Promise queue with concurrency control\",\n\t\"…

### YAML, a GitHub workflow: `.github/workflows/main.yml` in sindresorhus/p-queue@7f272ab5ff

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `setdown-mistake: 1`: error: Property setdown-mistake is not allowed.
- hover `runs-on`: #### GitHub Workflow The type of machine to run the job on. The machine can be either a GitHub-hosted runner, or a self-hosted runner. Source: [github-workflow…
- completion `runs-|`: 16 offered, first: needs, snapshot, permissions, cache-mode, runs-on, normalJob
- own `the schema of this file`: [{"name":"GitHub Workflow","uri":"https://www.schemastore.org/github-workflow.json","description":"YAML GitHub Workflow"}]
- own `every schema the tool knows`: [{"uri":"https://www.schemastore.org/github-workflow.json","fromStore":false,"usedForCurrentFile":true,"name":"GitHub Workflow","description":"YAML GitHub Work…

### CSS: `css/pico.css` in picocss/pico@a07563ddc8

css-lsp, installed by Setdown.

- clean: no error
- mistake `.setdown-mistake { colr: red; }`: warning: Unknown property: 'colr'
- hover `cursor: pointer`: Allows control over cursor appearance in an element ![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAw…
- completion `cursor: poin|`: 198 offered, first: alias, all-scroll, auto, cell, col-resize, context-menu

### HTML: `src/index.html` in h5bp/html5-boilerplate@7fa0bd6c9e

html-lsp, installed by Setdown.

- clean: no error
- mistake `<style>.setdown-mistake { colr: red; }</style><script>const setdownValue = 1; console.log(setdownValue);</script>`: warning: Unknown property: 'colr'
- hover `meta charset`: The meta element represents various kinds of metadata that cannot be expressed using the title, base, link, style, and script elements. ![Baseline icon](data:i…
- completion `<scr|`: 116 offered, first: html, head, title, base, link, meta
- own `the colours of the script inside the page`: {"data":[33,60,12,7,9,0,18,7,7,16,0,8,3,11,16,0,4,12,7,8]}
