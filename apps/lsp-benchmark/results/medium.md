# Language tools on real projects

Run 2026-11-18T18:59:46.081Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Python | pallets/flask | pyright | yes (0.3 s) | NO | yes, 2.0 s | yes (2 of 2), 1.0 s | yes, 1.0 s | yes (2 of 2), 1.0 s |
| JavaScript | expressjs/express | typescript-language-server | yes (0.2 s) | yes, 5.2 s | yes, 2.2 s | yes (2 of 2), 0.1 s | yes, 0.2 s | yes (2 of 2), 2.2 s |
| C | DaveGamble/cJSON | clangd | yes (0.3 s) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s |
| C++ | fmtlib/fmt | clangd | yes (0.1 s) | yes, 123.2 s | yes, 1.0 s | NO (0 of 2) | yes, 0.0 s | yes, 0.0 s |
| Go | spf13/cobra | gopls | yes (66.3 s, downloaded) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s |
| Go module file | spf13/cobra | gopls | yes (0.1 s) | yes, 183.2 s | yes, 2.0 s | NO | – | – |
| PHP | nikic/FastRoute | intelephense | yes (2.1 s) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s |

4 expectations were not met: python: clean; cpp: hover at vformat(format_str, args); cpp: hover at error_code; gomod: hover at github.com/spf13/pflag.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Python: `src/flask/app.py` in pallets/flask@49943b5a94

Pyright, included.

- clean (NOT as expected: no error above the added line): 2 errors: line 1137 Import "asgiref.sync" could not be resolved; line 1363 Argument of type "str | bytes | bytearray | Iterator[str] | Iterator[bytes] | Iterator[Unknown]" cannot be assigned to parameter "response"…
- mistake `setdown_mistake: int = "three"`: error: Type "Literal['three']" is not assignable to declared type "int"
- hover `MapAdapter | None:`: ```python class MapAdapter( map: Map, server_name: str, script_name: str, subdomain: str | None, url_scheme: str, path_info: str, default_method: str, query_ar…
- hover `get_debug_flag()`: ```python (function) def get_debug_flag() -> bool ``` --- Get whether debug mode should be enabled for the app, indicated by the `FLASK_DEBUG` environment vari…
- completion `self.url_map.bind_to_env|`: 1 offered, first: bind_to_environ
- definition `get_debug_flag()`: src/flask/helpers.py:28
- definition `MapAdapter | None:`: .venv/lib/python3.13/site-packages/werkzeug/routing/map.py:382

### JavaScript: `lib/application.js` in expressjs/express@43fca52d28

TypeScript and JavaScript, included.

- clean: no error
- mistake `var = ;`: error: Variable declaration expected.
- hover `finalhandler(req, res, {`: ```typescript import finalhandler ``` Module dependencies. *@private*
- hover `compileETag(val)`: ```typescript import compileETag ```
- completion `this.router.rou|`: 114 offered, first: _locals, all, app, apply, arg, args
- definition `compileETag(val)`: lib/utils.js:130
- definition `finalhandler(req, res, {`: lib/application.js:16

### C: `cJSON_Utils.c` in DaveGamble/cJSON@6d9f2443ab

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake(void) { return missing_name; }`: error: Use of undeclared identifier 'missing_name'; error: No previous prototype for function 'setdown_mistake' (fix available)
- hover `cJSON_IsArray(object)`: ### function `cJSON_IsArray` provided by `"cJSON.h"` --- → `cJSON_bool (aka int)` Parameters: - `const cJSON *const item (aka const struct cJSON *const)` --- `…
- hover `strlen((const char*)string)`: ### function `strlen` provided by `<string.h>` --- → `__size_t (aka unsigned long)` Parameters: - `const char * __s` Return the length of S. --- ```cpp extern …
- completion `cJSON_IsArr|`: 1 offered, first: •cJSON_IsArray
- definition `cJSON_IsArray(object)`: cJSON.c:3042

### C++: `src/os.cc` in fmtlib/fmt@14ac0d5a9d

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake() { return missing_name; }`: error: Use of undeclared identifier 'missing_name'; hint: Use a trailing return type for this function (fix available)
- hover `vformat(format_str, args)` (NOT as expected: text matching /vformat/): no answer
- hover `error_code` (NOT as expected: text matching /error_code/): no answer
- completion `std::generic_cat|`: 1 offered, first: •generic_category
- definition `close`: include/fmt/os.h:201

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
- mistake `setdown mistake`: error: unknown directive: setdown
- hover `github.com/spf13/pflag` (NOT as expected): error: getting modfile handle: /home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cobra/go.mod:11: unknown directive: setdown

### PHP: `src/RouteCollector.php` in nikic/FastRoute@1c961398be

intelephense, installed by Setdown.

- clean: no error
- mistake `function setdown_mistake(): void { echo missing_function(); }`: error: Undefined function 'FastRoute\missing_function'.
- hover `parse`: __FastRoute\\RouteParser::parse__ Parses a route string into multiple route data arrays. ```php <?php public function parse(string $route): array { } ``` The e…
- hover `ConfigureRoutes`: __FastRoute\\ConfigureRoutes__ ```php <?php interface ConfigureRoutes { } ```
- completion `$this->dataGenerator->addRou|`: 1 offered, first: addRoute
- definition `parse`: src/RouteParser.php:41
- definition `ConfigureRoutes`: src/ConfigureRoutes.php:13
