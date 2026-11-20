# Language tools on real projects

Run 2026-11-20T14:13:59.083Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Python | pallets/flask | pyright | yes (0.8 s) | yes, 4.4 s | yes, 1.4 s | yes (2 of 2), 0.3 s | yes, 0.4 s | yes (2 of 2), 0.4 s | – | – |
| Python | python-poetry/cleo | pyright | yes (0.3 s) | yes, 4.4 s | yes, 1.4 s | yes (2 of 2), 0.4 s | yes, 0.4 s | yes (2 of 2), 0.4 s | – | – |

Every expectation was met.

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

### Python: `tests/conftest.py` in python-poetry/cleo@30df50748e

Pyright, included.

- clean: no error
- mistake `setdown_mistake: int = "three"`: error: Type "Literal['three']" is not assignable to declared type "int"
- hover `BufferedIO(input_)`: ```python class BufferedIO( input: Input | None = None, decorated: bool = False, supports_utf8: bool = True ) ```
- hover `MockerFixture`: ```python class MockerFixture(config: Any) ``` --- Fixture that provides the same interface to functions in the mock module, ensuring that they are uninstalled…
- completion `input_.set_str|`: 1 offered, first: set_stream
- definition `BufferedIO(input_)`: src/cleo/io/buffered_io.py:15
- definition `MockerFixture`: ../../../../../../../../../../.cache/pypoetry/virtualenvs/cleo-UXhin33b-py3.13/lib/python3.13/site-packages/pytest_mock/plugin.py:80
