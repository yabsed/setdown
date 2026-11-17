from typing import (
    TYPE_CHECKING,
    Any,
    Final,
    Literal,
    TypeAlias,
    TypeVar,
)

if TYPE_CHECKING:
    import numpy as np
    from numpy import dtype
    from numpy.polynomial._polybase import ABCPolyBase
    from typing_extensions import Never

    StringDType: TypeAlias = dtype[Never]


__version__: Final = "20260602.2.0"

__all__ = (
    "NUMPY_GE_2_0",
    "NUMPY_GE_2_1",
    "NUMPY_GE_2_2",
    "NUMPY_GE_2_3",
    "NUMPY_GE_2_4",
    "NUMPY_GE_2_5",
    "ABCPolyBase",
    "CanArray",
    "LiteralFalse",
    "LiteralTrue",
    "StringDType",
    "__version__",
    "_check_version",
)


def __dir__() -> tuple[str, ...]:
    return __all__


__ALL_SET = frozenset(__all__)


def __getattr__(name: str, /) -> object:
    if name == "CanArray":
        from numpy import ndarray

        return ndarray
    if name == "StringDType":
        from numpy.dtypes import StringDType

        return StringDType

    if name == "ABCPolyBase":
        from numpy.polynomial._polybase import ABCPolyBase

        return ABCPolyBase

    if name in __ALL_SET and name in globals():
        return globals()[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


NUMPY_GE_2_0: Final = True
NUMPY_GE_2_1: Final = False
NUMPY_GE_2_2: Final = False
NUMPY_GE_2_3: Final = False
NUMPY_GE_2_4: Final = False
NUMPY_GE_2_5: Final = False


LiteralTrue: TypeAlias = Literal[True]
LiteralFalse: TypeAlias = Literal[False]


if TYPE_CHECKING:
    ShapeT = TypeVar("ShapeT", bound=tuple[int, ...])
    DTypeT = TypeVar("DTypeT", bound=np.dtype[Any])

    CanArray: TypeAlias = np.ndarray[ShapeT, DTypeT]


def _check_version() -> bool:
    """Check if the `numpy-typing-compat` version is compatible with `numpy`."""
    import numpy as np

    np_version = tuple(map(int, np.__version__.split(".", 2)[:2]))
    return (2, 0) <= np_version < (2, 1)
