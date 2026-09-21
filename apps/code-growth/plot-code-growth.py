#!/usr/bin/env python3
"""Plot physical code lines at every Git commit."""

from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault(
    "MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "setdown-matplotlib")
)

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ticker import FuncFormatter


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
CLEAN_OUTPUT = APP_DIR / "output" / "repository-code-growth.png"
DETAILED_OUTPUT = APP_DIR / "output" / "repository-code-growth-detailed.png"
SEOUL = ZoneInfo("Asia/Seoul")

BACKGROUND = "none"
INK = "#18323c"
MUTED = "#6f7f84"
LINE = "#12617a"
FILL = "#8ed1d3"
GRID = "#dbe7e8"
POSITIVE = "#258f83"
NEGATIVE = "#cf6f65"
ACCENT = "#e2a33a"
MARKER_EDGE = "#ffffff"

ROOT_CODE_FILES = {
    "index.html",
    "apps/desktop/index.html",
}
CODE_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".svelte",
    ".css",
    ".html",
    ".sh",
    ".py",
}
CODE_DIRECTORIES = (
    "src/", "test/", "scripts/",
    "apps/desktop/src/", "apps/desktop/test/", "apps/desktop/scripts/",
    "apps/code-growth/",
)
CONFIG_DIRECTORIES = {Path("."), Path("apps/desktop")}


def git(*args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, text=True, encoding="utf-8"
    )


def is_code_file(path: str) -> bool:
    candidate = Path(path)
    if path in ROOT_CODE_FILES:
        return True
    if candidate.suffix not in CODE_SUFFIXES:
        return False
    return path.startswith(CODE_DIRECTORIES) or (
        candidate.parent in CONFIG_DIRECTORIES and ".config." in candidate.name
    )


def code_lines(commit: str) -> int:
    paths = git("ls-tree", "-r", "--name-only", commit).splitlines()
    total = 0
    for path in paths:
        if not is_code_file(path):
            continue
        content = subprocess.check_output(
            ["git", "show", f"{commit}:{path}"], cwd=ROOT
        )
        total += len(content.splitlines())
    return total


def apply_type() -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    korean_font = "/usr/share/fonts/naver-nanum-gothic-fonts/NanumGothic.ttf"
    if Path(korean_font).exists():
        font_manager.fontManager.addfont(korean_font)
        plt.rcParams["font.family"] = "NanumGothic"
    plt.rcParams.update(
        {
            "axes.edgecolor": GRID,
            "axes.labelcolor": MUTED,
            "axes.titlecolor": INK,
            "text.color": INK,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
        }
    )


def style_time_axis(axis: plt.Axes) -> None:
    axis.xaxis.set_major_locator(mdates.HourLocator(byhour=range(0, 24, 6), tz=SEOUL))
    axis.xaxis.set_major_formatter(mdates.DateFormatter("%m.%d\n%H:%M", tz=SEOUL))
    axis.tick_params(axis="both", which="both", length=0, labelsize=10)
    axis.grid(axis="x", color=GRID, linewidth=0.8, alpha=0.48)
    axis.grid(axis="y", color=GRID, linewidth=0.9, alpha=0.72)
    axis.spines[["top", "right", "left", "bottom"]].set_visible(False)


def draw_growth(axis: plt.Axes, times: list[datetime], lines: list[int]) -> None:
    axis.set_facecolor(BACKGROUND)
    axis.fill_between(times, lines, step="post", color=FILL, alpha=0.30, zorder=1)
    axis.step(times, lines, where="post", color=LINE, linewidth=3.1, zorder=2)
    axis.scatter(
        times,
        lines,
        color=LINE,
        edgecolor=MARKER_EDGE,
        linewidth=0.75,
        s=27,
        zorder=3,
    )
    axis.scatter(
        [times[-1]],
        [lines[-1]],
        color=ACCENT,
        edgecolor=MARKER_EDGE,
        linewidth=1.2,
        s=72,
        zorder=4,
    )
    axis.yaxis.set_major_formatter(FuncFormatter(lambda value, _position: f"{int(value):,}"))
    axis.set_ylim(bottom=0, top=max(lines) * 1.07)
    axis.margins(x=0.015)
    style_time_axis(axis)


def draw_deltas(axis: plt.Axes, times: list[datetime], deltas: list[int]) -> None:
    axis.set_facecolor(BACKGROUND)
    delta_colors = [POSITIVE if delta >= 0 else NEGATIVE for delta in deltas]
    axis.vlines(times, 0, deltas, color=delta_colors, linewidth=2.2, alpha=0.88)
    axis.scatter(times, deltas, color=delta_colors, s=16, zorder=3)
    axis.axhline(0, color="#aab9bd", linewidth=0.9)
    axis.yaxis.set_major_formatter(
        FuncFormatter(lambda value, _position: f"{int(value):+,}")
    )
    style_time_axis(axis)
    axis.grid(axis="x", color=GRID, linewidth=0.8, alpha=0.48)
    axis.grid(axis="y", color=GRID, linewidth=0.8, alpha=0.58)


def save_clean(times: list[datetime], lines: list[int]) -> None:
    deltas = [lines[0], *(current - previous for previous, current in zip(lines, lines[1:]))]
    figure = plt.figure(figsize=(16, 9), dpi=160, facecolor=BACKGROUND)
    grid = figure.add_gridspec(
        2,
        1,
        height_ratios=(5.0, 1.25),
        left=0.055,
        right=0.99,
        top=0.985,
        bottom=0.08,
        hspace=0.08,
    )
    growth_axis = figure.add_subplot(grid[0])
    delta_axis = figure.add_subplot(grid[1], sharex=growth_axis)
    draw_growth(growth_axis, times, lines)
    growth_axis.tick_params(axis="x", labelbottom=False)
    draw_deltas(delta_axis, times, deltas)
    figure.savefig(CLEAN_OUTPUT, transparent=True, bbox_inches="tight")
    plt.close(figure)


def save_detailed(records: list[dict[str, object]]) -> None:
    times = [record["time"] for record in records]
    lines = [record["lines"] for record in records]
    deltas = [lines[0], *(current - previous for previous, current in zip(lines, lines[1:]))]
    elapsed_seconds = round((times[-1] - times[0]).total_seconds())
    hours, remainder = divmod(elapsed_seconds, 3600)
    minutes = remainder // 60

    figure = plt.figure(figsize=(16, 10), dpi=160, facecolor=BACKGROUND)
    grid = figure.add_gridspec(
        2,
        1,
        height_ratios=(5.0, 1.25),
        left=0.075,
        right=0.985,
        top=0.80,
        bottom=0.09,
        hspace=0.08,
    )
    growth_axis = figure.add_subplot(grid[0])
    delta_axis = figure.add_subplot(grid[1], sharex=growth_axis)
    draw_growth(growth_axis, times, lines)
    growth_axis.set_ylabel("Total lines of code", fontsize=10, labelpad=14)
    growth_axis.tick_params(axis="x", labelbottom=False)

    draw_deltas(delta_axis, times, deltas)
    delta_axis.set_ylabel("Change per commit", fontsize=10, labelpad=14)

    figure.text(0.075, 0.935, f"Setdown's first {hours} hours", fontsize=25, weight="bold")
    figure.text(
        0.075,
        0.893,
        "Repository growth and net change by actual commit time",
        fontsize=11.5,
        color=MUTED,
    )

    metrics = (
        ("Elapsed time", f"{hours}h {minutes}m"),
        ("Commits", f"{len(records)}"),
        ("Final size", f"{lines[-1]:,} lines"),
    )
    for x_position, (label, value) in zip((0.64, 0.76, 0.86), metrics):
        figure.text(x_position, 0.934, label, fontsize=9.5, color=MUTED)
        figure.text(x_position, 0.895, value, fontsize=16, weight="bold", color=INK)

    figure.text(
        0.985,
        0.025,
        "Included: app source · tests · build config   |   Excluded: README · reports · lockfiles · assets · vendor",
        ha="right",
        fontsize=8.5,
        color=MUTED,
    )
    figure.savefig(DETAILED_OUTPUT, transparent=True, bbox_inches="tight")
    plt.close(figure)


def main() -> None:
    records = []
    history = git(
        "log", "--reverse", "--format=%H%x09%cI%x09%s"
    ).splitlines()
    for row in history:
        commit, committed_at, subject = row.split("\t", 2)
        records.append(
            {
                "commit": commit,
                "time": datetime.fromisoformat(committed_at),
                "subject": subject,
                "lines": code_lines(commit),
            }
        )

    CLEAN_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    times = [record["time"] for record in records]
    lines = [record["lines"] for record in records]

    apply_type()
    save_clean(times, lines)
    save_detailed(records)

    print(f"Wrote {CLEAN_OUTPUT.relative_to(ROOT)}")
    print(f"Wrote {DETAILED_OUTPUT.relative_to(ROOT)}")
    print(f"Final code lines: {lines[-1]:,}")


if __name__ == "__main__":
    main()
