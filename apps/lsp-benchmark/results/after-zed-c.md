# Language tools on real projects

Run 2026-11-19T12:16:29.671Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C | DaveGamble/cJSON | clangd | yes (1.2 s) | yes, 3.0 s | yes, 0.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s |
| C++ | fmtlib/fmt | clangd | yes (0.9 s) | yes, 4.0 s | yes, 1.0 s | yes (2 of 2), 0.0 s | yes, 0.0 s | yes, 0.0 s | yes, 0.0 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### C: `cJSON_Utils.c` in DaveGamble/cJSON@6d9f2443ab

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake(void) { return missing_name; }`: error: No previous prototype for function 'setdown_mistake' (fix available); error: Use of undeclared identifier 'missing_name'
- hover `cJSON_IsArray(object)`: ### function `cJSON_IsArray` provided by `"cJSON.h"` --- → `cJSON_bool (aka int)` Parameters: - `const cJSON *const item (aka const struct cJSON *const)` --- `…
- hover `strlen((const char*)string)`: ### function `strlen` provided by `<string.h>` --- → `__size_t (aka unsigned long)` Parameters: - `const char * __s` Return the length of S. --- ```cpp extern …
- completion `cJSON_IsArr|`: 1 offered, first: •cJSON_IsArray
- faded `#pragma warning (disable : 4001)`: 7 regions left out: lines 25-25, 29-29, 32-34, 47-47, 50-50, 57-57, 62-62
- definition `cJSON_IsArray(object)`: cJSON.c:3042

### C++: `src/os.cc` in fmtlib/fmt@14ac0d5a9d

clangd, found on this computer.

- clean: no error
- mistake `int setdown_mistake() { return missing_name; }`: hint: Use a trailing return type for this function (fix available); error: Use of undeclared identifier 'missing_name'
- hover `error_code`: ### class `error_code` provided by `<system_error>` --- @addtogroup diagnostics @{ --- ```cpp // In namespace std class error_code {} ```
- hover `close`: ### instance-method `buffered_file::close` provided by `"fmt/os.h"` --- → `void` Closes the file. --- ```cpp // In buffered_file public: void buffered_file::cl…
- completion `std::generic_cat|`: 1 offered, first: •generic_category
- faded `#    define S_IRUSR _S_IREAD`: 16 regions left out: lines 10-10, 22-22, 28-31, 36-38, 43-60, 65-121, 135-167, 193-199
- definition `close`: include/fmt/os.h:201
