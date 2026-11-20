# Language tools on real projects

Run 2026-11-20T13:58:53.361Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Go | spf13/cobra | gopls | yes (1.8 s) | yes, 4.9 s | yes, 1.9 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | – | yes (6 of 6), 0.9 s |
| Go, a test for a function | spf13/cobra | gopls | yes (0.9 s) | yes, 3.0 s | – | yes, 0.0 s | – | – | – | yes, 0.0 s |
| Go module file | spf13/cobra | gopls | yes (1.1 s) | yes, 3.0 s | – | yes, 0.0 s | – | – | – | – |

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
- own `the packages that can be imported`: {"Packages":["archive/tar","archive/zip","bufio","bytes","cmp","compress/bzip2","compress/flate","compress/gzip","compress/lzw","compress/zlib","container/heap…
- own `add the import net/http`: {"documentChanges":[{"textDocument":{"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cobra/com…
- own `add json tags to Use`: {"documentChanges":[{"textDocument":{"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cobra/com…
- own `tags are asked for when the settings name none`: {"ask":"Tags to add, separated by commas, for example json,xml"}
- own `the go test line of a test lens`: {"cwd":"/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cobra","program":"go","args":["test","-test.fullpath…
- own `the Go versions to choose from`: {"current":"1.27.4-X:nodwarf5","chosen":false,"local":[{"label":"1.27.4-X:nodwarf5","program":"/usr/lib/golang/bin/go"}],"downloadable":[{"label":"Go 1.27.4","…

### Go, a test for a function: `args.go` in spf13/cobra@adbc881390

gopls, installed by Setdown.

- clean: no error
- hover `NoArgs`: ```go func NoArgs(cmd *Command, args []string) error ``` --- NoArgs returns an error if any args are included. --- [`cobra.NoArgs` on pkg.go.dev](https://pkg.g…
- own `a test for NoArgs`: {"documentChanges":[{"textDocument":{"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cobra/arg…

### Go module file: `go.mod` in spf13/cobra@adbc881390

gopls, installed by Setdown.

- clean: no error
- hover `github.com/spf13/pflag`: #### github.com/spf13/pflag This module is necessary because [github.com/spf13/pflag](https://pkg.go.dev/github.com/spf13/pflag@v1.0.9) is imported in `github.…
