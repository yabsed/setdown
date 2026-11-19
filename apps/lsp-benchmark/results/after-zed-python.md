# Language tools on real projects

Run 2026-11-19T11:48:43.926Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Python | pallets/flask | pyright | yes (1.7 s) | NO | yes, 1.9 s | yes (2 of 2), 0.9 s | yes, 0.9 s | yes (2 of 2), 0.9 s |

1 expectation was not met: python: clean.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Python: `src/flask/app.py` in pallets/flask@49943b5a94

Pyright, included.

- clean (NOT as expected: no error above the added line): 1 error: line 243 "response_class" overrides symbol of same name in class "App"; line 1363 accepted: Pyright does not take a bytearray where werkzeug declares bytes; flask is checked with mypy, which does
- mistake `setdown_mistake: int = "three"`: error: Type "Literal['three']" is not assignable to declared type "int"
- hover `MapAdapter | None:`: ```python class MapAdapter( map: Map, server_name: str, script_name: str, subdomain: str | None, url_scheme: str, path_info: str, default_method: str, query_ar…
- hover `get_debug_flag()`: ```python (function) def get_debug_flag() -> bool ``` --- Get whether debug mode should be enabled for the app, indicated by the `FLASK_DEBUG` environment vari…
- completion `self.url_map.bind_to_env|`: 1 offered, first: bind_to_environ
- definition `get_debug_flag()`: src/flask/helpers.py:28
- definition `MapAdapter | None:`: .venv/lib/python3.13/site-packages/werkzeug/routing/map.py:382
