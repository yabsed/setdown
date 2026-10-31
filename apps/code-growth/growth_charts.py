"""Headless charts for architecture, product features and test kinds."""

import os
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "setdown-matplotlib"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.ticker import StrMethodFormatter

from metrics import LIMIT_NOTE, SCOPE_NOTE, VIEWS, provenance

SEOUL = ZoneInfo("Asia/Seoul")
COMMIT_AXIS_LABEL = "Commit timestamp (Asia/Seoul, UTC+09:00)\nCalendar time at each measured commit"
TITLES = {
    "components": ("Setdown architecture", "All measured code; tests and tooling are separate components"),
    "features": ("Setdown product features", "Production source only; files grouped by path-based responsibility"),
    "tests": ("Setdown test code", "Unit/service, E2E/integration, support and code fixtures"),
}
SIZE_LABELS = {
    "components": "Total measured code (lines)",
    "features": "Production code (lines)",
    "tests": "Test and support code (lines)",
}


def plot_breakdown(records: list[dict], output: Path, view: str, ref: str) -> None:
    # Standalone and full builds must render the same chart regardless of the
    # total plot's font/style settings in this process.
    with plt.style.context("default"):
        _plot_breakdown(records, output, view, ref)


def _plot_breakdown(records: list[dict], output: Path, view: str, ref: str) -> None:
    labels = VIEWS[view]
    times = [record["time"] for record in records]
    final = records[-1][view]
    figure, axis = plt.subplots(figsize=(16, 9))
    figure.subplots_adjust(left=0.095, right=0.73, top=0.80, bottom=0.24)
    keys = [
        key for key in sorted(labels, key=lambda key: final[key], reverse=True)
        if any(record[view][key] for record in records)
    ]
    palette = plt.get_cmap("tab20")
    if keys:
        axis.stackplot(
            times,
            *[[record[view][key] for record in records] for key in keys],
            labels=[f"{labels[key]}: {final[key]:,}" for key in keys],
            colors=[palette(index) for index in range(len(keys))],
            step="post", baseline="zero", alpha=0.9, linewidth=0.4, edgecolor="white",
        )
        axis.legend(
            loc="upper left", bbox_to_anchor=(1.02, 1), frameon=False,
            fontsize=10, labelspacing=1, title="Category: latest size (lines)", title_fontsize=11,
        )
    else:
        axis.text(0.5, 0.5, "No measured code in this view", transform=axis.transAxes, ha="center")
    axis.set_ylim(bottom=0, top=max(1, max(sum(record[view].values()) for record in records) * 1.05))
    axis.set_ylabel(
        f"{SIZE_LABELS[view]}\nIncludes blank lines and comments",
        fontsize=12, weight="semibold", labelpad=14,
    )
    axis.set_xlabel(COMMIT_AXIS_LABEL, fontsize=11, weight="semibold", labelpad=10)
    axis.yaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
    axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=8, tz=SEOUL))
    axis.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d", tz=SEOUL))
    axis.tick_params(axis="both", labelsize=10)
    axis.grid(alpha=0.2)
    axis.spines[["top", "right"]].set_visible(False)
    title, description = TITLES[view]
    figure.text(0.07, 0.94, title, fontsize=24, weight="bold")
    figure.text(0.07, 0.895, f"{description} | Total: {sum(final.values()):,} lines", fontsize=12)
    figure.text(
        0.07, 0.85,
        "How to read Y: each band's thickness = category line count; top of the stack = total.",
        fontsize=11,
    )
    figure.text(0.07, 0.09, provenance(records, ref), fontsize=9)
    figure.text(0.07, 0.065, SCOPE_NOTE, fontsize=9)
    figure.text(0.07, 0.04, LIMIT_NOTE, fontsize=9)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=160, bbox_inches="tight")
    plt.close(figure)
