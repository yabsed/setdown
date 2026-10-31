"""Density must weight lines, count Unicode characters and preserve missing data."""

import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import code_density
from code_density import LineStats


class DensityTests(unittest.TestCase):
    def test_unicode_whitespace_and_line_endings(self):
        stats = LineStats.from_bytes("  한😀\t \r\n \t\r\n".encode())
        self.assertEqual((stats.physical_lines, stats.nonblank_lines, stats.characters, stats.over_160), (2, 1, 6, 0))
        self.assertEqual(stats.values()["mean_characters"], 6)
        self.assertEqual(stats.values()["blank_percent"], 50)
        self.assertEqual(stats.values()["mean_stripped_characters"], 2)
        self.assertEqual(LineStats.from_bytes(b"x"), LineStats.from_bytes(b"x\n"))
        self.assertEqual(LineStats.from_bytes(b"x\nx"), LineStats.from_bytes(b"x\rx"))
        self.assertEqual(LineStats.from_bytes("x\u2028x".encode()).characters, 3)

    def test_weighted_mean_and_strict_long_line_threshold(self):
        combined = LineStats.from_bytes(b"x" * 160)
        combined.add(LineStats.from_bytes(b"x\nx\nx\n"))
        self.assertEqual(combined.values()["mean_characters"], 163 / 4)
        self.assertEqual(combined.over_160, 0)
        self.assertEqual(LineStats.from_bytes(b"x" * 161).over_160, 1)
        self.assertIsNone(LineStats.from_bytes(b"\n \n").values()["mean_characters"])
        self.assertIsNone(LineStats.from_bytes(b"").values()["mean_characters"])

    def test_pooled_percentiles_and_tail_sensitivity(self):
        lengths = [1, 1, 1, 160]
        combined = LineStats.from_bytes(b"x" * 160)
        short = LineStats.from_bytes(b"x\nx\nx\n")
        combined.add(short)
        self.assertEqual(short.nonblank_lines, 3)
        self.assertEqual(combined.percentile(.5), statistics.median(lengths))
        self.assertAlmostEqual(combined.percentile(.9), statistics.quantiles(lengths, n=10, method="inclusive")[8])
        self.assertEqual(combined.percentile(0), 1)
        self.assertEqual(combined.percentile(1), 160)
        self.assertEqual(combined.mean_without_longest_one_percent(), 163 / 4)
        self.assertIsNone(LineStats().percentile(.9))
        self.assertIsNone(LineStats().mean_without_longest_one_percent())
        one = LineStats.from_bytes(b"xx")
        self.assertEqual(one.percentile(.9), 2)
        repeated = LineStats.from_bytes(b"x\n" * 99 + b"x" * 1000)
        self.assertEqual(repeated.mean_without_longest_one_percent(), 1)
        with self.assertRaises(ValueError):
            one.percentile(1.1)

    def test_snapshot_scope_renames_missing_files_and_exports(self):
        commits = [
            {"commit": "a" * 40, "time": datetime(2026, 9, 11, tzinfo=timezone.utc)},
            {"commit": "b" * 40, "time": datetime(2026, 9, 12, tzinfo=timezone.utc)},
            {"commit": "c" * 40, "time": datetime(2026, 9, 13, tzinfo=timezone.utc)},
        ]
        contents = {"main": b"x" * 160, "test": b"x\nx\nx\n", "tools": b"xx\n"}
        snapshots = {
            commits[0]["commit"]: [("main", "src/main/main.ts"), ("test", "test/a.test.ts"), ("tools", "scripts/build.py"), ("excluded", "reports/vitest.config.ts")],
            commits[1]["commit"]: [("main", "apps/desktop/src/main/main.ts"), ("test", "apps/desktop/test/a.test.ts"), ("tools", "scripts/build.py")],
            commits[2]["commit"]: [("test", "apps/desktop/test/a.test.ts")],
        }
        with patch.object(code_density, "code_blobs", side_effect=lambda sha: snapshots[sha]), patch.object(code_density, "BlobLineCounter") as batch:
            reader = batch.return_value.__enter__.return_value
            reader.blob.side_effect = contents.__getitem__
            records = code_density.density_history("topic", commits=commits)
            self.assertEqual(reader.blob.call_count, 3)  # Each unique included blob read once.
        self.assertEqual(records[0]["groups"], records[1]["groups"])
        self.assertEqual(records[0]["groups"]["all"]["mean_characters"], 165 / 5)
        self.assertEqual(records[0]["groups"]["production"]["mean_characters"], 160)
        self.assertEqual(records[0]["groups"]["tests"]["mean_characters"], 1)
        self.assertNotIn("samples", records[0])
        self.assertEqual(records[0]["groups"]["all"]["median_characters"], 1)
        self.assertAlmostEqual(records[0]["groups"]["all"]["p90_characters"], 96.8)
        self.assertIsNone(records[2]["groups"]["production"]["mean_characters"])
        with tempfile.TemporaryDirectory(prefix="density-test-") as temporary:
            root = Path(temporary)
            code_density.write_data(records, "topic", root)
            with (root / f"{code_density.STEM}.csv").open() as handle:
                rows = list(csv.DictReader(handle))
            missing = next(row for row in rows if row["commit"] == "c" * 40 and row["series"] == "production")
            self.assertEqual(missing["mean_characters"], "")
            summary = json.loads((root / f"{code_density.STEM}.json").read_text())
            self.assertEqual(summary["resolved_commit"], "c" * 40)
            self.assertNotIn("samples", summary)
            self.assertEqual(summary["first_nonempty"]["commit"], "a" * 40)
            self.assertEqual(len(rows), 12)
            self.assertEqual(set(row["series"] for row in rows), {"all", "production", "tests", "tooling"})
