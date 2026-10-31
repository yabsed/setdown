"""Regressions for exclusions, directory moves, merges and auditable totals."""

import csv
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import git_history
import metrics


class ClassificationTests(unittest.TestCase):
    def test_scope_does_not_leak_config_files_or_count_its_own_code(self):
        for path in (
            "reports/bug-audit-2026-10-22/vitest.config.ts",
            "vendor/library/vite.config.js", "docs/example.config.ts",
            "apps/code-growth/metrics.py", "apps/code-growth/test.config.ts",
            "scripts/plot-code-growth.py", "apps/desktop/src/catalog.json",
            "apps/desktop/public/icon.svg", "package-lock.json",
            "apps/another-app/src/main.ts",
        ):
            with self.subTest(path=path):
                self.assertFalse(metrics.is_code_file(path))
        for path in (
            "vite.config.ts", "apps/desktop/playwright.wayland.config.ts",
            "src/renderer/App.jsx", "tests/example.spec.ts", "scripts/ci/check.mjs",
            "apps/desktop/src/renderer/App.svelte", "apps/desktop/index.html",
        ):
            with self.subTest(path=path):
                self.assertTrue(metrics.is_code_file(path))

    def test_current_runtimes_are_not_legacy(self):
        for folder, expected in (
            ("browser-runtime", "browser_runtime"), ("image-runtime", "image_runtime"),
            ("image-export-runtime", "image_export_runtime"), ("launcher", "launcher"),
            ("hwp-runtime", "hwp_runtime"),
        ):
            self.assertEqual(metrics.component_for_path(f"apps/desktop/src/{folder}/index.ts"), expected)
        self.assertEqual(metrics.component_for_path("apps/desktop/src/new-runtime/index.ts"), "other")
        self.assertEqual(metrics.feature_for_path("apps/desktop/src/new-runtime/index.ts"), "other")

    def test_test_helpers_and_fixtures_are_not_scenarios(self):
        cases = {
            "test/e2e/app.ts": "support",
            "apps/desktop/test/support/electron/electron-app.ts": "support",
            "apps/desktop/test/e2e/browser/navigation.spec.ts": "integration",
            "apps/desktop/src/main/documents/text-files.integration.test.ts": "integration",
            "apps/desktop/src/main/browser/browser-manager.test.ts": "unit",
            "scripts/ci/config.test.mjs": "unit",
            "apps/desktop/test/fixtures/notebook/dataframe.html": "fixtures",
            "test/e2e/fixtures/fake.test.ts": "fixtures",
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(metrics.test_kind_for_path(path), expected)
                self.assertEqual(metrics.component_for_path(path), "tests")

    def test_feature_ownership_survives_known_directory_moves(self):
        pairs = [
            ("src/shared/contracts.ts", "apps/desktop/src/protocol/desktop-api.ts", "shared"),
            ("src/shared/preview-blocks.ts", "apps/desktop/src/core/preview/preview-blocks.ts", "reading"),
            ("src/preview/bridge.ts", "apps/desktop/src/preview-runtime/bridge.ts", "reading"),
            ("src/renderer/components/ReaderSurface.svelte", "apps/desktop/src/renderer/reader/ReaderSurface.svelte", "reading"),
            ("apps/desktop/src/renderer/editor/language-client.ts", "apps/desktop/src/renderer/language/language-client.ts", "language"),
            ("apps/desktop/src/renderer/browser/LocationBar.svelte", "apps/desktop/src/renderer/workspace/location/LocationBar.svelte", "workspace"),
            ("apps/desktop/src/core/browser/extension-package.ts", "apps/desktop/src/main/browser/extension-package.ts", "browser"),
        ]
        for before, after, expected in pairs:
            with self.subTest(before=before):
                self.assertEqual(metrics.feature_for_path(before), expected)
                self.assertEqual(metrics.feature_for_path(after), expected)


class GitHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="code-growth-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {
            **os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_AUTHOR_NAME": "Code Growth Test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Code Growth Test", "GIT_COMMITTER_EMAIL": "test@example.invalid",
        }
        self.git("init", "--initial-branch=main")
        self.root_patch = patch.object(git_history, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, env=self.env, stderr=subprocess.PIPE).decode().strip()

    def write(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8")

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def test_merge_history_moves_and_dirty_worktree(self):
        self.write("src/shared/contracts.ts", "// declaration\n\nexport type X = string;")
        self.write("test/e2e/app.ts", "helper\n")
        self.write("test/e2e/app.spec.ts", "scenario\nassertion\n")
        self.write("vite.config.ts", "config\n")
        self.write("reports/bug-audit/vitest.config.ts", "excluded\n" * 40)
        self.write("scripts/plot-code-growth.py", "excluded\n" * 50)
        first = self.commit("initial")
        (self.root / "apps/desktop").mkdir(parents=True)
        for path in ("src", "test", "vite.config.ts"):
            self.git("mv", path, f"apps/desktop/{path}")
        moved = self.commit("move without changing bytes")
        self.git("checkout", "-b", "feature")
        # Repeated blobs count for each path; -z parsing must preserve newlines.
        self.write("apps/desktop/src/browser-runtime/page\nscript.jsx", "browser\n")
        self.write("apps/desktop/src/browser-runtime/other.jsx", "browser\n")
        branch = self.commit("branch code")
        self.git("checkout", "main")
        self.write("docs/readme.md", "documentation\n")
        mainline = self.commit("main documentation")
        self.git("merge", "--no-ff", "feature", "-m", "merge feature")
        merged = self.git("rev-parse", "HEAD")
        self.write("apps/desktop/src/shared/contracts.ts", "dirty\n" * 100)
        self.git("add", "apps/desktop/src/shared/contracts.ts")
        self.write("apps/desktop/src/main/untracked.ts", "untracked\n" * 100)

        records = metrics.history("main")
        self.assertEqual([r["commit"] for r in records], [first, moved, mainline, merged])
        self.assertNotIn(branch, [r["commit"] for r in records])
        self.assertEqual([r["lines"] for r in records], [7, 7, 7, 9])
        self.assertEqual([r["delta"] for r in records], [7, 0, 0, 2])
        for view in metrics.VIEWS:
            self.assertEqual(records[0][view], records[1][view])
        last = records[-1]
        self.assertEqual((last["production"], last["testing"], last["tooling"]), (5, 3, 1))
        self.assertEqual(last["features"]["browser"], 2)
        self.assertEqual(last["tests"]["support"], 1)
        self.assertEqual(last["tests"]["integration"], 2)
        self.assertEqual(sum(f["lines"] for f in last["files"]), 9)
        self.assertEqual(metrics.history("feature")[-1]["commit"], branch)

        output = self.root / "output"
        metrics.write_csv(records, output / "total.csv")
        for view in metrics.VIEWS:
            metrics.write_csv(records, output / f"{view}.csv", view)
        for filename, expected in (("total", 9), ("components", 9), ("features", 5), ("tests", 3)):
            self.assertNotIn(b"\r", (output / f"{filename}.csv").read_bytes())
            with (output / f"{filename}.csv").open() as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[-1]["commit"], merged)
            self.assertEqual(int(rows[-1]["total"]), expected)
        metrics.write_audit(records, "main", output)
        summary = json.loads((output / "repository-code-growth-summary.json").read_text())
        self.assertEqual(summary["resolved_commit"], merged)
        self.assertEqual(summary["unclassified_files"], [])
        with (output / "repository-code-growth-files.csv").open() as handle:
            files = list(csv.DictReader(handle))
        self.assertIn("apps/desktop/src/browser-runtime/page\nscript.jsx", [f["path"] for f in files])

    def test_no_code_history_renders_without_a_display(self):
        self.write("README.md", "no measured code\n")
        self.commit("documentation only")
        records = metrics.history()
        record = records[0]
        self.assertEqual(record["lines"], 0)
        self.assertEqual(record["files"], [])
        from growth_charts import plot_breakdown
        import matplotlib

        total = runpy.run_path(str(metrics.APP_DIR / "plot-code-growth.py"))
        self.assertEqual(matplotlib.get_backend().lower(), "agg")
        for view in metrics.VIEWS:
            output = self.root / f"{view}.png"
            plot_breakdown(records, output, view, "main")
            self.assertTrue(output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
        for kind in ("clean", "detailed"):
            output = self.root / f"{kind}.png"
            total[f"save_{kind}"](records, "main", output)
            self.assertTrue(output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))


if __name__ == "__main__":
    unittest.main()
