#!/usr/bin/env python3
"""Plot Setdown's codebase composition across main's first-parent history."""

from __future__ import annotations

import argparse
import json
import math
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
from matplotlib import font_manager


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
OUTPUT = APP_DIR / "output" / "repository-component-growth.png"
DATA_OUTPUT = APP_DIR / "output" / "repository-component-growth.json"

BACKGROUND = "#050505"
FOREGROUND = "#f3f3f3"
MUTED = "#b6b6b6"
GRID = "#242424"
FINAL_GUIDE = "#eeeeee"

COMPONENTS = OrderedDict(
    [
        ("tests", ("Tests", "#0a84ff")),
        ("renderer", ("Renderer", "#00b348")),
        ("main", ("Main", "#e59200")),
        ("core", ("Core", "#df4a10")),
        ("preview_runtime", ("Preview runtime", "#9a82c9")),
        ("tooling", ("Tooling", "#ee3d8f")),
        ("protocol", ("Protocol", "#0a84ff")),
        ("preload", ("Preload", "#00b348")),
        ("legacy", ("Legacy / other", "#e59200")),
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

TOOLING_FILES = {
    "apps/desktop/playwright.config.ts",
    "apps/desktop/playwright.preview-benchmark.config.ts",
    "apps/desktop/playwright.preview-contract.config.ts",
    "apps/desktop/svelte.config.js",
    "apps/desktop/vite.config.ts",
    "apps/desktop/vitest.config.ts",
    "apps/desktop/vitest.preview-contract.config.ts",
}


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8", errors="replace")


def is_test_path(path: str) -> bool:
    name = Path(path).name
    return (
        "/test/" in f"/{path}"
        or "/tests/" in f"/{path}"
        or ".test." in name
        or ".spec." in name
    )


def is_code_file(path: str) -> bool:
    if path.startswith("apps/code-growth/"):
        return False
    if path in ROOT_CODE_FILES:
        return True
    candidate = Path(path)
    if candidate.suffix not in CODE_SUFFIXES:
        return False
    return (
        path.startswith(("src/", "test/", "tests/", "scripts/", "apps/"))
        or ".config." in candidate.name
    )


def component_for_path(path: str) -> str:
    if is_test_path(path):
        return "tests"
    if path == "apps/desktop/index.html" or path.startswith("apps/desktop/src/renderer/"):
        return "renderer"
    if path.startswith("apps/desktop/src/main/"):
        return "main"
    if path.startswith("apps/desktop/src/core/"):
        return "core"
    if path.startswith("apps/desktop/src/preview-runtime/"):
        return "preview_runtime"
    if (
        path.startswith("apps/desktop/scripts/")
        or path in TOOLING_FILES
        or (Path(path).parent == Path("apps/desktop") and ".config." in Path(path).name)
    ):
        return "tooling"
    if path.startswith("apps/desktop/src/protocol/"):
        return "protocol"
    if path.startswith("apps/desktop/src/preload/"):
        return "preload"
    return "legacy"


class BlobLineCounter(AbstractContextManager["BlobLineCounter"]):
    """Count physical lines by blob SHA and cache unchanged blobs across commits."""

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


def first_parent_history(ref: str) -> list[dict[str, object]]:
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


def choose_font() -> None:
    preferred_names = (
        "Noto Sans CJK KR",
        "Noto Sans KR",
        "NanumGothic",
        "Malgun Gothic",
        "AppleGothic",
    )
    installed = {font.name for font in font_manager.fontManager.ttflist}
    for name in preferred_names:
        if name in installed:
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False


def round_axis_ceiling(value: int) -> int:
    if value <= 0:
        return 1
    magnitude = 10 ** max(0, int(math.floor(math.log10(value))) - 1)
    step = max(500, 20 * magnitude)
    return int(math.ceil(value / step) * step)


def draw_summary(
    figure: plt.Figure,
    final_values: dict[str, int],
) -> None:
    lefts = (0.07, 0.39, 0.71)
    tops = (0.805, 0.700, 0.595)

    for index, (key, (label, color)) in enumerate(COMPONENTS.items()):
        row, column = divmod(index, 3)
        x = lefts[column]
        y = tops[row]
        figure.add_artist(
            plt.Line2D(
                [x, x],
                [y - 0.035, y + 0.015],
                transform=figure.transFigure,
                color=color,
                linewidth=5.5,
                solid_capstyle="round",
            )
        )
        figure.text(x + 0.028, y + 0.010, label, color=FOREGROUND, fontsize=14)
        figure.text(
            x + 0.028,
            y - 0.025,
            f"{final_values[key]:,}",
            color=FOREGROUND,
            fontsize=20,
        )


def plot_component_growth(
    records: list[dict[str, object]],
    output: Path,
) -> None:
    choose_font()
    plt.rcParams.update(
        {
            "figure.facecolor": BACKGROUND,
            "axes.facecolor": BACKGROUND,
            "savefig.facecolor": BACKGROUND,
            "text.color": FOREGROUND,
            "axes.labelcolor": MUTED,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
        }
    )

    elapsed = [float(record["elapsed_hours"]) for record in records]
    final_values = records[-1]["components"]
    all_values = [
        int(record["components"][key])
        for record in records
        for key in COMPONENTS
    ]
    y_max = round_axis_ceiling(max(all_values))

    figure = plt.figure(figsize=(10, 14.2), dpi=180)
    figure.text(
        0.045,
        0.955,
        "Setdown 코드 구성요소 성장",
        fontsize=25,
        weight="bold",
        color=FOREGROUND,
    )
    figure.text(
        0.045,
        0.915,
        "Main first-parent history의 실제 스냅샷. Physical LOC,\n"
        "문서·vendor·lockfile·assets 제외.",
        fontsize=15.5,
        color=MUTED,
        linespacing=1.65,
    )

    draw_summary(figure, final_values)

    axis = figure.add_axes([0.16, 0.075, 0.79, 0.43])
    for key, (_label, color) in COMPONENTS.items():
        values = [int(record["components"][key]) for record in records]
        axis.plot(
            elapsed,
            values,
            color=color,
            linewidth=2.6,
            solid_capstyle="round",
            solid_joinstyle="round",
            antialiased=True,
        )

    final_x = elapsed[-1]
    axis.axvline(final_x, color=FINAL_GUIDE, linewidth=1.35, alpha=0.95)
    for key, (_label, color) in COMPONENTS.items():
        value = int(final_values[key])
        axis.scatter(
            [final_x],
            [value],
            s=135,
            color=color,
            edgecolor="#2b2b2b",
            linewidth=1.2,
            zorder=5,
            clip_on=False,
        )

    axis.text(
        final_x,
        y_max * 1.025,
        f"{final_x:.1f}",
        ha="right",
        va="bottom",
        fontsize=16,
        weight="bold",
        color=FOREGROUND,
    )

    axis.set_xlim(0, final_x * 1.01 if final_x else 1)
    axis.set_ylim(0, y_max)
    axis.set_xlabel("첫 커밋 이후 경과 시간 (h)", fontsize=14, labelpad=12)
    axis.set_ylabel("Physical LOC", fontsize=13, labelpad=14)

    yticks = [0, y_max * 0.25, y_max * 0.5, y_max * 0.75, y_max]
    axis.set_yticks(yticks)
    axis.set_yticklabels(
        ["0", "", "", "", f"{y_max:,}"],
        fontsize=13,
    )
    axis.set_xticks([0, final_x])
    axis.set_xticklabels(
        ["0", f"{int(round(final_x))}"],
        fontsize=13,
    )

    axis.grid(axis="y", color=GRID, linewidth=0.8, alpha=0.8)
    axis.grid(axis="x", visible=False)
    axis.tick_params(axis="both", which="both", length=0, pad=8)
    for spine in axis.spines.values():
        spine.set_visible(False)

    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, bbox_inches="tight", pad_inches=0.22)
    plt.close(figure)


def write_data(records: list[dict[str, object]], path: Path) -> None:
    payload = {
        "history": "main first-parent",
        "measurement": "physical LOC",
        "commits": [
            {
                "commit": record["commit"],
                "committedAt": record["time"].isoformat(),
                "elapsedHours": round(float(record["elapsed_hours"]), 4),
                "components": record["components"],
            }
            for record in records
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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
        default=OUTPUT,
        help=f"PNG output path (default: {OUTPUT.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--data-output",
        type=Path,
        default=DATA_OUTPUT,
        help=f"JSON output path (default: {DATA_OUTPUT.relative_to(ROOT)})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records = first_parent_history(args.ref)
    plot_component_growth(records, args.output)
    write_data(records, args.data_output)

    final_values = records[-1]["components"]
    print(f"Wrote {args.output}")
    print(f"Wrote {args.data_output}")
    print(
        "Final component LOC: "
        + ", ".join(
            f"{COMPONENTS[key][0]}={int(final_values[key]):,}" for key in COMPONENTS
        )
    )


if __name__ == "__main__":
    main()
