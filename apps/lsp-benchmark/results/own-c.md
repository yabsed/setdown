# Language tools on real projects

Run 2026-11-20T13:05:45.889Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C | DaveGamble/cJSON | clangd | yes (0.4 s) | yes, 3.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s | yes (3 of 3), 0.0 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### C: `cJSON_Utils.c` in DaveGamble/cJSON@6d9f2443ab

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake(void) { return missing_name; }`: error: Use of undeclared identifier 'missing_name'; error: No previous prototype for function 'setdown_mistake' (fix available)
- hover `cJSON_IsArray(object)`: ### function `cJSON_IsArray` provided by `"cJSON.h"` --- → `cJSON_bool (aka int)` Parameters: - `const cJSON *const item (aka const struct cJSON *const)` --- `…
- hover `strlen((const char*)string)`: ### function `strlen` provided by `<string.h>` --- → `__size_t (aka unsigned long)` Parameters: - `const char * __s` Return the length of S. --- ```cpp extern …
- completion `cJSON_IsArr|`: 1 offered, first: •cJSON_IsArray
- faded `#pragma warning (disable : 4001)`: 7 regions left out: lines 25-25, 29-29, 32-34, 47-47, 50-50, 57-57, 62-62
- definition `cJSON_IsArray(object)`: cJSON.c:3042
- own `textDocument/switchSourceHeader`: file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cjson/cJSON_Utils.h
- own `textDocument/ast`: {"arcana":"CallExpr 0x7f3d20158eb8 </home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/cjson/cJSON_Utils.c:221:…
- own `$/memoryUsage`: {"_self":0,"_total":7187687,"clangd_server":{"_self":0,"_total":7187687,"background_index":{"_self":0,"_total":3708416,"index":{"_self":2499246,"_total":249924…
