"""Repository-wide nonblank line length and distribution at every commit."""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from dataclasses import dataclass, field
import json
import math
from pathlib import Path

from git_history import BlobLineCounter, code_blobs
from metrics import (
    DEFAULT_REF, OUTPUT_DIR, commit_history, component_for_path, is_code_file,
    provenance,
)

GROUPS = {
    "all": "All measured code",
    "production": "Production source",
    "tests": "Tests / support",
    "tooling": "Tooling",
}
STEM = "repository-code-density"


@dataclass
class LineStats:
    physical_lines: int = 0
    nonblank_lines: int = 0
    characters: int = 0
    over_160: int = 0
    stripped_characters: int = 0
    lengths: Counter[int] = field(default_factory=Counter, repr=False)

    @classmethod
    def from_bytes(cls, content: bytes) -> LineStats:
        # Count Unicode code points, not UTF-8 bytes or visual display columns.
        text = content.decode("utf-8")
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if text else []
        if lines and lines[-1] == "":
            lines.pop()  # A terminal newline does not create an extra blank row.
        nonblank = [line for line in lines if line.strip()]
        lengths = Counter(map(len, nonblank))
        return cls(
            len(lines), len(nonblank), sum(map(len, nonblank)),
            sum(len(line) > 160 for line in nonblank),
            sum(len(line.strip()) for line in nonblank), lengths,
        )

    def add(self, other: LineStats) -> None:
        """Accumulate into a fresh snapshot; cached blob statistics stay unchanged."""
        self.physical_lines += other.physical_lines
        self.nonblank_lines += other.nonblank_lines
        self.characters += other.characters
        self.over_160 += other.over_160
        self.stripped_characters += other.stripped_characters
        self.lengths.update(other.lengths)

    def percentile(self, probability: float) -> float | None:
        """Linear interpolation of pooled observations, equivalent to R type 7."""
        if not 0 <= probability <= 1:
            raise ValueError("Percentile probability must be between zero and one")
        if not self.nonblank_lines:
            return None
        position = (self.nonblank_lines - 1) * probability
        low, high = math.floor(position), math.ceil(position)
        count = 0
        low_value = None
        for length, frequency in sorted(self.lengths.items()):
            count += frequency
            if low_value is None and count > low:
                low_value = length
            if count > high:
                return low_value + (length - low_value) * (position - low)
        raise ValueError("Line count does not match the length histogram")

    def mean_without_longest_one_percent(self) -> float | None:
        if not self.nonblank_lines:
            return None
        retained = self.nonblank_lines - self.nonblank_lines // 100
        remaining, total = retained, 0
        for length, frequency in sorted(self.lengths.items()):
            taken = min(frequency, remaining)
            total += length * taken
            remaining -= taken
            if not remaining:
                return total / retained
        raise ValueError("Line count does not match the length histogram")

    def values(self) -> dict:
        return {
            "physical_lines": self.physical_lines, "nonblank_lines": self.nonblank_lines,
            "characters": self.characters, "stripped_characters": self.stripped_characters,
            "over_160": self.over_160,
            "mean_characters": self.characters / self.nonblank_lines if self.nonblank_lines else None,
            "mean_stripped_characters": self.stripped_characters / self.nonblank_lines if self.nonblank_lines else None,
            "p10_characters": self.percentile(0.1), "median_characters": self.percentile(0.5),
            "p90_characters": self.percentile(0.9),
            "mean_without_longest_1_percent": self.mean_without_longest_one_percent(),
            "over_160_percent": 100 * self.over_160 / self.nonblank_lines if self.nonblank_lines else None,
            "blank_percent": 100 * (self.physical_lines - self.nonblank_lines) / self.physical_lines if self.physical_lines else None,
        }


def density_history(ref: str = DEFAULT_REF, *, commits: list[dict] | None = None) -> list[dict]:
    records = []
    cache: dict[str, LineStats] = {}
    with BlobLineCounter() as counter:
        for commit in commits if commits is not None else commit_history(ref):
            groups = {key: LineStats() for key in GROUPS}
            for sha, path in code_blobs(commit["commit"]):
                if not is_code_file(path):
                    continue
                if sha not in cache:
                    try:
                        cache[sha] = LineStats.from_bytes(counter.blob(sha))
                    except UnicodeDecodeError as error:
                        raise ValueError(f"Non-UTF-8 code at {commit['commit']}:{path}") from error
                stats = cache[sha]
                component = component_for_path(path)
                group = component if component in {"tests", "tooling"} else "production"
                groups["all"].add(stats)
                groups[group].add(stats)
            records.append({
                "commit": commit["commit"], "time": commit["time"],
                "groups": {key: value.values() for key, value in groups.items()},
            })
    return records


def write_data(records: list[dict], ref: str, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    with (output / f"{STEM}.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, lineterminator="\n", fieldnames=[
            "commit", "committed_at", "series", *LineStats().values(),
        ])
        writer.writeheader()
        for record in records:
            for key, values in record["groups"].items():
                writer.writerow({
                    "commit": record["commit"], "committed_at": record["time"].isoformat(),
                    "series": key, **values,
                })
    first = next((record for record in records if record["groups"]["all"]["nonblank_lines"]), None)
    summary = {
        "schema_version": 2,
        "ref": ref, "resolved_commit": records[-1]["commit"], "history": "first-parent",
        "commit_count": len(records), "timezone": "Asia/Seoul",
        "metric": "Sum of characters in nonblank lines / number of nonblank lines; line-weighted, not file-weighted",
        "character_count": "Unicode code points including indentation, trailing spaces and comments; tabs count as one; CR/LF excluded",
        "scope": "Same owned-code policy as growth charts; all = production + tests/support + tooling; no uncommitted changes",
        "sampling": "Full snapshot at each commit, not changed lines; empty groups have no mean or percentile, never zero",
        "percentiles": "Pooled nonblank lines, linear interpolation (R type 7); percentiles are not averaged across files",
        "stripped_mean": "Remove only leading/trailing whitespace with str.strip(); internal whitespace/comments/strings retained",
        "tail_sensitivity": "Discard the longest floor(0.01 * nonblank_lines) lines; groups below 100 lines stay unchanged; re-evaluate independently per snapshot/group",
        "over_160_percent": "Strictly greater than 160 code points / nonblank lines; descriptive threshold, not a validated quality cutoff",
        "blank_percent": "Whitespace-only physical lines / all physical lines",
        "interpretation": "File composition and formatting both affect these metrics. No causal claim or readability/quality score; comments and strings are not parsed out.",
        "first_nonempty": {
            "commit": first["commit"], "committed_at": first["time"].isoformat(),
            "groups": first["groups"],
        } if first else None,
        "latest": records[-1]["groups"],
    }
    (output / f"{STEM}.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


def plot(records: list[dict], ref: str, output: Path, *, by_characters: bool = False) -> None:
    from growth_charts import SEOUL  # Sets the headless backend before pyplot.
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator, StrMethodFormatter

    # Every series uses the same repository total. Keep first-parent order:
    # deletions can move left and equal-size snapshots can have different means.
    positions = [
        record["groups"]["all"]["characters"] if by_characters else record["time"]
        for record in records
    ]
    with plt.style.context("default"):
        figure, axes = plt.subplots(2, 2, figsize=(18, 12), sharex=True)
        figure.subplots_adjust(left=0.06, right=0.98, top=0.83, bottom=0.18, hspace=0.32, wspace=0.18)
        overall, distribution, controls, proportions = axes.flat

        def line(axis, key, label, color, group="all", **kwargs):
            values = [record["groups"][group][key] for record in records]
            if not any(value is not None for value in values):
                return
            last = values[-1]
            caption = f"{label}: {last:.1f}" if last is not None else label
            axis.plot(positions, values, color=color, linewidth=2, label=caption, **kwargs)
            if by_characters and last is not None:
                axis.plot(positions[-1], last, marker="o", color=color, markersize=5)

        line(overall, "mean_characters", "All code", "#172d38")
        line(overall, "mean_characters", "Production", "#147c95", "production")
        line(overall, "mean_characters", "Tests / support", "#ae7130", "tests")
        overall.set_title("1. Mean length across every included file", loc="left", fontsize=13, pad=12)
        line(distribution, "p90_characters", "90th percentile", "#8864ac")
        line(distribution, "mean_characters", "Mean", "#172d38")
        line(distribution, "median_characters", "Median", "#147c95")
        distribution.set_title("2. Typical lines and the longer tail — all code", loc="left", fontsize=13, pad=12)
        line(controls, "mean_characters", "Raw mean", "#172d38")
        line(controls, "mean_stripped_characters", "After edge whitespace removal", "#147c95")
        line(controls, "mean_without_longest_1_percent", "Without longest 1%", "#c4573b", linestyle="--")
        controls.set_title("3. Sensitivity to whitespace and extremes — all code", loc="left", fontsize=13, pad=12)
        line(proportions, "over_160_percent", ">160 chars / nonblank lines", "#c4573b")
        line(proportions, "blank_percent", "Blank / physical lines", "#147c95")
        proportions.set_title("4. Long-line and blank-line shares — all code", loc="left", fontsize=13, pad=12)

        for axis in axes.flat:
            axis.set_ylabel("Characters / nonblank line" if axis is not proportions else "Percent")
            axis.set_ylim(bottom=0)
            axis.grid(alpha=0.18)
            axis.spines[["top", "right"]].set_visible(False)
            if axis.lines:
                axis.legend(loc="upper left", frameon=False, fontsize=9)
            else:
                axis.text(0.5, 0.5, "No measured nonblank code", transform=axis.transAxes, ha="center")
            if by_characters:
                axis.set_xlim(left=0, right=max(1, max(positions) * 1.05))
                axis.xaxis.set_major_locator(MaxNLocator(nbins=5, integer=True))
                axis.xaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
            else:
                axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=5, tz=SEOUL))
                axis.xaxis.set_major_formatter(mdates.DateFormatter("%m.%d\n%Y", tz=SEOUL))
        for axis in axes[1]:
            axis.set_xlabel("Total characters in all measured code" if by_characters else "Commit date (Asia/Seoul)")
        figure.text(0.06, 0.95, "Characters per nonblank line", fontsize=26, weight="bold")
        subtitle = (
            "By repository size at each commit; filled dots mark the latest snapshot"
            if by_characters else
            "Repository-wide measurements at every commit: mean, distribution and sensitivity"
        )
        figure.text(0.06, 0.905, subtitle, fontsize=14)
        figure.text(0.06, 0.105, provenance(records, ref), fontsize=9)
        figure.text(0.06, 0.08, "Unicode code points; comments, strings and indentation included. Line endings and whitespace-only lines excluded." if by_characters else "Unicode code points; comments and strings included. Raw lengths include indentation; line endings are excluded.", fontsize=9)
        figure.text(0.06, 0.055, "X = snapshot total, not cumulative additions. Lines follow first-parent order, may move left; all series share the same X." if by_characters else "Panels 2–4 pool all measured files. Each snapshot is measured independently; file composition can change over time.", fontsize=9)
        figure.text(0.06, 0.03, "No smoothing. 160 is a descriptive threshold, not a quality cutoff. Line length alone does not measure readability.", fontsize=9)
        output.parent.mkdir(parents=True, exist_ok=True)
        figure.savefig(output, dpi=160, bbox_inches="tight")
        plt.close(figure)


def generate(ref: str, output: Path, *, commits: list[dict] | None = None) -> list[dict]:
    records = density_history(ref, commits=commits)
    write_data(records, ref, output)
    plot(records, ref, output / f"{STEM}.png")
    plot(records, ref, output / f"{STEM}-by-characters.png", by_characters=True)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default=DEFAULT_REF)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    records = generate(args.ref, args.output_dir)
    print(f"Wrote {args.output_dir / STEM}.png/.csv/.json")
    print(f"Wrote {args.output_dir / STEM}-by-characters.png")
    print(f"Measured {len(records)} commits through {records[-1]['commit']}")
    print(json.dumps(records[-1]["groups"]["all"], indent=2))


if __name__ == "__main__":
    main()
