#!/usr/bin/env python3
"""Render one breakdown using the same measurement policy as the total plot."""

import argparse
from pathlib import Path

from growth_charts import plot_breakdown
from metrics import DEFAULT_REF, OUTPUT_DIR, STEMS, VIEWS, history, write_csv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default=DEFAULT_REF, help="First-parent Git ref (default: main)")
    parser.add_argument("--view", choices=VIEWS, default="components")
    parser.add_argument("--output", type=Path, help="PNG output path")
    parser.add_argument("--data-output", type=Path, help="CSV output path")
    args = parser.parse_args()
    output = args.output or OUTPUT_DIR / f"{STEMS[args.view]}.png"
    data_output = args.data_output or OUTPUT_DIR / f"{STEMS[args.view]}.csv"
    records = history(args.ref)
    plot_breakdown(records, output, args.view, args.ref)
    write_csv(records, data_output, args.view)
    print(f"Wrote {output}\nWrote {data_output}")
    print(f"Measured {records[-1]['commit']} ({len(records)} first-parent commits)")


if __name__ == "__main__":
    main()
