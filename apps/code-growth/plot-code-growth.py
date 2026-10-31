#!/usr/bin/env python3
"""Plot committed physical LOC on one first-parent history."""

from __future__ import annotations

import argparse
import os
import tempfile
from datetime import datetime
from pathlib import Path
from time import monotonic
from zoneinfo import ZoneInfo

from metrics import (
    DEFAULT_REF, LIMIT_NOTE, OUTPUT_DIR, SCOPE_NOTE, STEMS, VIEWS,
    history, provenance, write_audit, write_csv,
)

os.environ.setdefault(
    "MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "setdown-matplotlib")
)

import matplotlib

# This script saves PNGs and must not open a desktop window from an IDE.
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ticker import FuncFormatter


APP_DIR = Path(__file__).resolve().parent
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
    axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=8, tz=SEOUL))
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
    axis.set_ylim(bottom=0, top=max(1, max(lines) * 1.07))
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


def add_footer(figure: plt.Figure, records: list[dict], ref: str) -> None:
    figure.text(0.075, 0.065, provenance(records, ref), fontsize=8.5, color=MUTED)
    figure.text(0.075, 0.04, SCOPE_NOTE, fontsize=8.5, color=MUTED)
    figure.text(0.075, 0.015, LIMIT_NOTE, fontsize=8.5, color=MUTED)


def save_clean(records: list[dict], ref: str, output: Path) -> None:
    times = [record["time"] for record in records]
    lines = [record["lines"] for record in records]
    deltas = [record["delta"] for record in records]
    figure = plt.figure(figsize=(16, 9), dpi=160, facecolor=BACKGROUND)
    grid = figure.add_gridspec(
        2,
        1,
        height_ratios=(5.0, 1.25),
        left=0.055,
        right=0.99,
        top=0.985,
        bottom=0.17,
        hspace=0.08,
    )
    growth_axis = figure.add_subplot(grid[0])
    delta_axis = figure.add_subplot(grid[1], sharex=growth_axis)
    draw_growth(growth_axis, times, lines)
    growth_axis.set_ylabel("Physical LOC")
    growth_axis.tick_params(axis="x", labelbottom=False)
    draw_deltas(delta_axis, times, deltas)
    delta_axis.set_ylabel("Net change")
    delta_axis.set_xlabel("Commit date (Asia/Seoul)")
    add_footer(figure, records, ref)
    figure.savefig(output, transparent=True, bbox_inches="tight")
    plt.close(figure)


def save_detailed(records: list[dict], ref: str, output: Path) -> None:
    times = [record["time"] for record in records]
    lines = [record["lines"] for record in records]
    deltas = [record["delta"] for record in records]
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
        bottom=0.17,
        hspace=0.08,
    )
    growth_axis = figure.add_subplot(grid[0])
    delta_axis = figure.add_subplot(grid[1], sharex=growth_axis)
    draw_growth(growth_axis, times, lines)
    growth_axis.set_ylabel("Physical LOC (including blanks/comments)", fontsize=10, labelpad=14)
    growth_axis.tick_params(axis="x", labelbottom=False)

    draw_deltas(delta_axis, times, deltas)
    delta_axis.set_ylabel("Change per commit", fontsize=10, labelpad=14)
    delta_axis.set_xlabel("Commit date (Asia/Seoul)")

    figure.text(0.075, 0.935, "Setdown code growth", fontsize=25, weight="bold")
    figure.text(
        0.075,
        0.893,
        "Committed code and net change along first-parent history",
        fontsize=11.5,
        color=MUTED,
    )

    metrics = (
        ("Calendar span", f"{hours // 24}d {hours % 24}h {minutes}m"),
        ("Commits", f"{len(records)}"),
        ("Final size", f"{lines[-1]:,} lines"),
    )
    for x_position, (label, value) in zip((0.64, 0.76, 0.86), metrics):
        figure.text(x_position, 0.934, label, fontsize=9.5, color=MUTED)
        figure.text(x_position, 0.895, value, fontsize=16, weight="bold", color=INK)

    last = records[-1]
    figure.text(0.075, 0.85,
                f"Production: {last['production']:,}  |  Tests/support: {last['testing']:,}  |  Tooling: {last['tooling']:,}",
                fontsize=11, color=MUTED)
    add_footer(figure, records, ref)
    figure.savefig(output, transparent=True, bbox_inches="tight")
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default=DEFAULT_REF, help="First-parent Git ref (default: main)")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--all", action="store_true", help="Also render architecture, feature and test charts from this snapshot")
    args = parser.parse_args()
    started = monotonic()
    print(f"Counting {args.ref} first-parent history…", flush=True)
    records = history(args.ref)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    apply_type()
    save_clean(records, args.ref, args.output_dir / CLEAN_OUTPUT.name)
    save_detailed(records, args.ref, args.output_dir / DETAILED_OUTPUT.name)
    write_csv(records, args.output_dir / "repository-code-growth.csv")
    write_audit(records, args.ref, args.output_dir)
    if args.all:
        from growth_charts import plot_breakdown

        for view in VIEWS:
            plot_breakdown(records, args.output_dir / f"{STEMS[view]}.png", view, args.ref)
            write_csv(records, args.output_dir / f"{STEMS[view]}.csv", view)
        from code_density import generate

        generate(args.ref, args.output_dir, commits=records)
    print(f"Wrote outputs to {args.output_dir}")
    print(f"Measured {records[-1]['commit']} ({len(records)} first-parent commits)")
    print(f"Final physical LOC: {records[-1]['lines']:,}")
    print(f"Completed in {monotonic() - started:.1f}s")


if __name__ == "__main__":
    main()
