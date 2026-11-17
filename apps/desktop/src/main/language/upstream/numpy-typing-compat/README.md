# numpy-typing-compat 20260602

The published builds of [numpy-typing-compat](https://github.com/jorenham/numpy-typing-compat)
`20260602.2.0` … `20260602.2.5`, one per NumPy minor version, unmodified from PyPI.
`scipy-stubs` reads NumPy-version-dependent types through `optype`, which imports this
package; Setdown offers the folder that matches the NumPy of the selected environment.

Upstream renders these files from `templates/__init__.py.jinja` (see the
`vendor/numpy-typing-compat` submodule, tag `v20260602`). To update, pin the submodule
to the new tag and replace each `2.N/numpy_typing_compat` with the contents of
`pip download --no-deps numpy-typing-compat==<build>.2.N`.
