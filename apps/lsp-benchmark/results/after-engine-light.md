# Language tools on real projects

Run 2026-11-19T11:46:34.361Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Go | spf13/cobra | gopls | yes (2.2 s) | yes, 4.1 s | yes, 1.1 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes (2 of 2), 0.1 s |
| Go module file | spf13/cobra | gopls | yes (0.9 s) | yes, 3.0 s | – | yes, 0.0 s | – | – |
| JSON | sindresorhus/p-queue | json-lsp | yes (1.7 s) | yes, 4.2 s | yes, 1.2 s | yes, 0.2 s | yes, 0.2 s | – |
| JSON with comments | sindresorhus/p-queue | json-lsp | yes (1.4 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| JSON, a web manifest | h5bp/html5-boilerplate | json-lsp | yes (1.0 s) | yes, 4.0 s | yes, 1.0 s | – | – | – |
| JSON, a Prettier file | h5bp/html5-boilerplate | json-lsp | yes (1.0 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |
| JSON with comments, a jsconfig | sveltejs/realworld | json-lsp | yes (0.9 s) | yes, 4.3 s | yes, 1.3 s | yes, 0.3 s | – | – |
| HTML | h5bp/html5-boilerplate | html-lsp | yes (2.7 s) | yes, 4.0 s | yes, 1.0 s | yes, 0.0 s | yes, 0.0 s | – |

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

### HTML: `src/index.html` in h5bp/html5-boilerplate@7fa0bd6c9e

html-lsp, installed by Setdown.

- clean: no error
- mistake `<style>.setdown-mistake { colr: red; }</style>`: warning: Unknown property: 'colr'
- hover `meta charset`: The meta element represents various kinds of metadata that cannot be expressed using the title, base, link, style, and script elements. ![Baseline icon](data:i…
- completion `<scr|`: 116 offered, first: html, head, title, base, link, meta
