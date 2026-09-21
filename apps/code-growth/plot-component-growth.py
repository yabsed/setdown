#!/usr/bin/env python3
"""Plot physical LOC growth by Setdown architectural component."""

from __future__ import annotations

import argparse
import csv
import os
import subprocess
import tempfile
from collections import OrderedDict
from contextlib import AbstractContextManager
from datetime import datetime
from pathlib import Path

os.environ.setdefault(
    "MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "setdown-matplotlib")
)

import matplotlib.pyplot as plt


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
PNG_OUTPUT = APP_DIR / "output" / "repository-component-growth-line.png"
CSV_OUTPUT = APP_DIR / "output" / "repository-component-growth-line.csv"

COMPONENTS = OrderedDict(
    [
        ("tests", "Tests"),
        ("renderer", "Renderer"),
        ("main", "Main"),
        ("core", "Core"),
        ("preview_runtime", "Preview runtime"),
        ("tooling", "Tooling"),
        ("protocol", "Protocol"),
        ("preload", "Preload"),
        ("legacy", "Legacy / other"),
    ]
)

CODE_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".svelte",
    ".css",
    ".html",
    ".sh",
    ".py",
}

ROOT_CODE_FILES = {
    "index.html",
    "apps/desktop/index.html",
}

CURRENT_TOOLING_FILES = {
    "apps/desktop/playwright.config.ts",
    "apps/desktop/playwright.preview-benchmark.config.ts",
    "apps/desktop/playwright.preview-contract.config.ts",
    "apps/desktop/svelte.config.js",
    "apps/desktop/vite.config.ts",
    "apps/desktop/vitest.config.ts",
    "apps/desktop/vitest.preview-contract.config.ts",
}

LEGACY_TOOLING_FILES = {
    "playwright.config.ts",
    "svelte.config.js",
    "vite.config.ts",
    "vitest.config.ts",
}

# Keep the measurement independent from the program that measures it, including
# the pre-monorepo location of the original total-growth script.
SELF_ANALYSIS_PATHS = {
    "scripts/plot-code-growth.py",
}


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8", errors="replace")


def is_test_path(path: str) -> bool:
    name = Path(path).name
    padded = f"/{path}"
    return (
        "/test/" in padded
        or "/tests/" in padded
        or ".test." in name
        or ".spec." in name
    )


def is_code_file(path: str) -> bool:
    if path.startswith("apps/code-growth/") or path in SELF_ANALYSIS_PATHS:
        return False
    if path in ROOT_CODE_FILES:
        return True

    candidate = Path(path)
    if candidate.suffix not in CODE_SUFFIXES:
        return False

    return (
        path.startswith(
            (
                "src/",
                "test/",
                "tests/",
                "scripts/",
                "apps/desktop/src/",
                "apps/desktop/test/",
                "apps/desktop/tests/",
                "apps/desktop/scripts/",
            )
        )
        or path in CURRENT_TOOLING_FILES
        or path in LEGACY_TOOLING_FILES
        or ".config." in candidate.name
    )


def component_for_path(path: str) -> str:
    # Tests win even when they live inside core/main/renderer.
    if is_test_path(path):
        return "tests"

    # Current monorepo paths and their pre-monorepo equivalents are deliberately
    # mapped to the same semantic component so directory moves do not look like
    # code growth.
    if (
        path in {"index.html", "apps/desktop/index.html"}
        or path.startswith(("src/renderer/", "apps/desktop/src/renderer/"))
    ):
        return "renderer"

    if path.startswith(("src/main/", "apps/desktop/src/main/")):
        return "main"

    if path in {
        "src/shared/contracts.ts",
        "apps/desktop/src/shared/contracts.ts",
    } or path.startswith("apps/desktop/src/protocol/"):
        return "protocol"

    if path.startswith(
        (
            "src/shared/",
            "apps/desktop/src/shared/",
            "apps/desktop/src/core/",
        )
    ):
        return "core"

    if path.startswith(("src/preview/", "apps/desktop/src/preview-runtime/")):
        return "preview_runtime"

    if path.startswith(("src/preload/", "apps/desktop/src/preload/")):
        return "preload"

    if (
        path.startswith(("scripts/", "apps/desktop/scripts/"))
        or path in CURRENT_TOOLING_FILES
        or path in LEGACY_TOOLING_FILES
        or ".config." in Path(path).name
    ):
        return "tooling"

    return "legacy"


class BlobLineCounter(AbstractContextManager["BlobLineCounter"]):
    """Count physical lines once per blob SHA across the full history."""

    def __init__(self) -> None:
        self.cache: dict[str, int] = {}
        self.process = subprocess.Popen(
            ["git", "cat-file", "--batch"],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        if self.process.stdin:
            self.process.stdin.close()
        if self.process.stdout:
            self.process.stdout.close()
        self.process.terminate()
        self.process.wait(timeout=5)

    def lines(self, sha: str) -> int:
        cached = self.cache.get(sha)
        if cached is not None:
            return cached

        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("git cat-file batch process is unavailable")

        self.process.stdin.write(f"{sha}\n".encode())
        self.process.stdin.flush()

        header = self.process.stdout.readline().decode("ascii", errors="replace").strip()
        parts = header.split()
        if len(parts) != 3 or parts[1] != "blob":
            raise RuntimeError(f"unexpected git cat-file response for {sha}: {header}")

        size = int(parts[2])
        content = self.process.stdout.read(size)
        self.process.stdout.read(1)

        count = len(content.splitlines())
        self.cache[sha] = count
        return count


def snapshot_components(commit: str, counter: BlobLineCounter) -> dict[str, int]:
    totals = {key: 0 for key in COMPONENTS}
    tree = git_bytes("ls-tree", "-r", "-z", "--full-tree", commit)

    for entry in tree.split(b"\0"):
        if not entry:
            continue

        metadata, raw_path = entry.split(b"\t", 1)
        _mode, kind, sha = metadata.decode("ascii").split()
        if kind != "blob":
            continue

        path = raw_path.decode("utf-8", errors="surrogateescape")
        if not is_code_file(path):
            continue

        totals[component_for_path(path)] += counter.lines(sha)

    return totals


def history(ref: str) -> list[dict[str, object]]:
    rows = git_text(
        "log",
        "--first-parent",
        "--reverse",
        "--format=%H%x09%cI%x09%s",
        ref,
    ).splitlines()
    if not rows:
        raise RuntimeError(f"no commits found for ref {ref!r}")

    records: list[dict[str, object]] = []
    with BlobLineCounter() as counter:
        for row in rows:
            commit, committed_at, subject = row.split("\t", 2)
            records.append(
                {
                    "commit": commit,
                    "time": datetime.fromisoformat(committed_at),
                    "subject": subject,
                    "components": snapshot_components(commit, counter),
                }
            )

    first_time = records[0]["time"]
    for record in records:
        record["elapsed_hours"] = (
            record["time"] - first_time
        ).total_seconds() / 3600

    return records


def write_csv(records: list[dict[str, object]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "commit",
            "committed_at",
            "elapsed_hours",
            *COMPONENTS.keys(),
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        for record in records:
            row = {
                "commit": record["commit"],
                "committed_at": record["time"].isoformat(),
                "elapsed_hours": f"{float(record['elapsed_hours']):.4f}",
            }
            row.update(record["components"])
            writer.writerow(row)


def plot(records: list[dict[str, object]], output: Path) -> None:
    elapsed = [float(record["elapsed_hours"]) for record in records]

    figure, axis = plt.subplots(figsize=(14, 8))

    for key, label in COMPONENTS.items():
        values = [int(record["components"][key]) for record in records]
        if not any(values):
            continue
        axis.plot(elapsed, values, label=label, linewidth=2.3)

    axis.set_title("Setdown component LOC growth")
    axis.set_xlabel("Elapsed hours since first commit")
    axis.set_ylabel("Physical LOC")
    axis.set_xlim(left=0)
    axis.set_ylim(bottom=0)
    axis.grid(True, alpha=0.25)
    axis.legend(ncol=2, frameon=False, loc="upper left")

    final_x = elapsed[-1]
    final_components = records[-1]["components"]
    for key in ("tests", "renderer", "main", "core", "preview_runtime"):
        value = int(final_components[key])
        axis.annotate(
            f"{COMPONENTS[key]}: {value:,}",
            xy=(final_x, value),
            xytext=(8, 0),
            textcoords="offset points",
            va="center",
            fontsize=9,
        )

    figure.text(
        0.5,
        0.015,
        "Main first-parent history. Pre-refactor paths are classified by semantic role; "
        "docs/vendor/assets/lockfiles and the code-growth tool itself are excluded.",
        ha="center",
        fontsize=9,
    )
    figure.tight_layout(rect=[0, 0.04, 1, 1])

    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(figure)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ref",
        default="main",
        help="Git ref whose first-parent history should be measured (default: main)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PNG_OUTPUT,
        help=f"PNG output path (default: {PNG_OUTPUT.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--data-output",
        type=Path,
        default=CSV_OUTPUT,
        help=f"CSV output path (default: {CSV_OUTPUT.relative_to(ROOT)})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records = history(args.ref)
    plot(records, args.output)
    write_csv(records, args.data_output)

    final = records[-1]["components"]
    print(f"Wrote {args.output}")
    print(f"Wrote {args.data_output}")
    print(
        "Final component LOC: "
        + ", ".join(
            f"{COMPONENTS[key]}={int(final[key]):,}" for key in COMPONENTS
        )
    )


if __name__ == "__main__":
    main()
