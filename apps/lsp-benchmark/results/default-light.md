# Language tools on real projects

Run 2026-11-19T07:22:07.502Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Go | spf13/cobra | gopls | yes (2.1 s) | yes, 4.1 s | yes, 1.1 s | yes (2 of 2), 0.1 s | yes, 0.1 s | yes (2 of 2), 0.1 s |
| Go module file | spf13/cobra | gopls | yes (0.9 s) | yes, 3.0 s | – | yes, 0.0 s | – | – |
| JSON | sindresorhus/p-queue | json-lsp | yes (1.5 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| JSON with comments | sindresorhus/p-queue | json-lsp | yes (1.4 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| JSON, a web manifest | h5bp/html5-boilerplate | json-lsp | yes (1.0 s) | yes, 4.0 s | yes, 1.0 s | – | – | – |
| JSON, a Prettier file | h5bp/html5-boilerplate | json-lsp | yes (1.0 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| JSON with comments, a jsconfig | sveltejs/realworld | json-lsp | yes (1.0 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | – | – |
| YAML | spf13/cobra | yaml-language-server | yes (2.0 s) | yes, 4.5 s | yes, 1.5 s | yes, 0.5 s | – | – |
| YAML, a GitHub workflow | sindresorhus/p-queue | yaml-language-server | yes (1.1 s) | yes, 5.1 s | yes, 2.1 s | yes, 1.1 s | yes, 1.1 s | – |
| Dockerfile | docker/awesome-compose | dockerfile-language-server | yes (2.3 s) | yes, 3.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | – |
| Docker Compose | docker/awesome-compose | yaml-language-server | yes (1.9 s) | yes, 4.4 s | yes, 1.4 s | yes (2 of 2), 0.4 s | yes, 0.4 s | – |
| CSS | picocss/pico | css-lsp | yes (1.7 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| SCSS | picocss/pico | css-lsp | yes (1.6 s) | yes, 4.1 s | yes, 1.1 s | yes, 0.0 s | yes, 0.1 s | – |
| Less | twbs/bootstrap | css-lsp | yes (1.5 s) | yes, 4.1 s | yes, 1.1 s | yes, 0.0 s | yes, 0.1 s | – |
| HTML | h5bp/html5-boilerplate | html-lsp | yes (3.0 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Go: `command.go` in spf13/cobra@adbc881390

gopls, installed by Setdown.

- clean: no error
- mistake `var setdownMistake string = 1`: error: cannot use 1 (untyped int constant) as string value in variable declaration
- hover `GetBool`: ```go func (f *flag.FlagSet) GetBool(name string) (bool, error) ``` --- GetBool return the bool value of a flag with the given name --- [`(pflag.FlagSet).GetBo…
- hover `ExecuteC`: ```go func (c *Command) ExecuteC() (cmd *Command, err error) ``` --- ExecuteC executes the command. --- [`(cobra.Command).ExecuteC` on pkg.go.dev](https://pkg.…
- completion `c.Flags().ArgsLenAt|`: 1 offered, first: ArgsLenAtDash
- definition `GetBool`: ../../../../../../../../../../go/pkg/mod/github.com/spf13/pflag@v1.0.9/bool.go:39
- definition `Root`: command.go:892

### Go module file: `go.mod` in spf13/cobra@adbc881390

gopls, installed by Setdown.

- clean: no error
- hover `github.com/spf13/pflag`: #### github.com/spf13/pflag This module is necessary because [github.com/spf13/pflag](https://pkg.go.dev/github.com/spf13/pflag@v1.0.9) is imported in `github.…

### JSON: `package.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"scripts"`: The 'scripts' member is an object hash of script commands that are run at various times in the lifecycle of your package\. The key is the lifecycle event, and …
- completion `"scr|`: 48 offered, first: homepage, bugs, licenses, author, contributors, maintainers

### JSON with comments: `tsconfig.json` in sindresorhus/p-queue@7f272ab5ff

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"outDir"`: If specified, `.js` (as well as `.d.ts`, `.js.map`, etc.) files will be emitted into this directory. The directory structure of the original source files is pr…
- completion `"rootD|`: 117 offered, first: allowArbitraryExtensions, allowImportingTsExtensions, charset, composite, customConditions, declaration

### JSON, a web manifest: `src/site.webmanifest` in h5bp/html5-boilerplate@7fa0bd6c9e

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.

### JSON, a Prettier file: `.prettierrc.json` in h5bp/html5-boilerplate@7fa0bd6c9e

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"singleQuote"`: Use single quotes instead of double quotes\.
- completion `"bracketSameL|`: 27 offered, first: arrowParens, bracketSameLine, bracketSpacing, checkIgnorePragma, cursorOffset, endOfLine

### JSON with comments, a jsconfig: `jsconfig.json` in sveltejs/realworld@df79670804

json-lsp, installed by Setdown.

- clean: no error
- mistake `{}`: error: End of file expected.
- hover `"extends"`: Path to base configuration file to inherit from \(requires TypeScript version 2\.1 or later\), or array of base files, with the rightmost files having the grea…

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

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `setdown_mistake: 1`: error: Property setdown_mistake is not allowed.
- hover `healthcheck:`: #### docker-compose.yml Configure a health check for the container to monitor its health status. Source: [compose-spec.json](https://raw.githubusercontent.com/…
- hover `depends_on:`: #### docker-compose.yml Express dependency between services. Service dependencies cause services to be started in dependency order. The dependent service will …
- completion `healthch|`: 86 offered, first: annotations, blkio_config, cap_add, cap_drop, cgroup, cgroup_parent

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

html-lsp, found on this computer.

- clean: no error
- mistake `<style>.setdown-mistake { colr: red; }</style>`: warning: Unknown property: 'colr'
- hover `meta charset`: The meta element represents various kinds of metadata that cannot be expressed using the title, base, link, style, and script elements. ![Baseline icon](data:i…
- completion `<scr|`: 116 offered, first: html, head, title, base, link, meta
