# Language tools on real projects

Run 2026-11-19T12:06:08.097Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Python | python-poetry/cleo | pyright | yes (0.8 s) | yes, 4.2 s | yes, 1.2 s | yes (2 of 2), 0.2 s | yes, 0.2 s | yes (2 of 2), 0.2 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Python: `tests/conftest.py` in python-poetry/cleo@30df50748e

Pyright, included.

- clean: no error
- mistake `setdown_mistake: int = "three"`: error: Type "Literal['three']" is not assignable to declared type "int"
- hover `BufferedIO(input_)`: ```python class BufferedIO( input: Input | None = None, decorated: bool = False, supports_utf8: bool = True ) ```
- hover `MockerFixture`: ```python class MockerFixture(config: Any) ``` --- Fixture that provides the same interface to functions in the mock module, ensuring that they are uninstalled…
- completion `input_.set_str|`: 1 offered, first: set_stream
- definition `BufferedIO(input_)`: src/cleo/io/buffered_io.py:15
- definition `MockerFixture`: ../../../../../../../../../../.cache/pypoetry/virtualenvs/cleo-UXhin33b-py3.13/lib/python3.13/site-packages/pytest_mock/plugin.py:80
