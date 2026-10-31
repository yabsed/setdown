"""One file policy and first-parent history for every code-growth view."""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path, PurePosixPath

from git_history import BlobLineCounter, code_blobs, git_text

APP_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = APP_DIR / "output"
DEFAULT_REF = "main"

COMPONENTS = {
    "tests": "Tests / support",
    "renderer": "Renderer",
    "main": "Main",
    "core": "Core",
    "preview_runtime": "Preview runtime",
    "browser_runtime": "Browser runtime",
    "image_runtime": "Image runtime",
    "image_export_runtime": "Image export runtime",
    "hwp_runtime": "HWP runtime (historical)",
    "protocol": "Protocol",
    "preload": "Preload",
    "launcher": "Launcher",
    "types": "Shared declarations",
    "tooling": "Tooling",
    "other": "Other / unclassified",
}
FEATURES = {
    "workspace": "Workspace / documents",
    "reading": "Reading / preview",
    "editor": "Text editing",
    "browser": "Browser",
    "language": "Language support",
    "notebook": "Notebooks",
    "git": "Git / review",
    "project": "Explorer / search",
    "media": "Images / PDF / video",
    "hwp": "HWP (historical)",
    "terminal": "Terminal",
    "theme": "Themes / shared UI",
    "shared": "Shared infrastructure",
    "other": "Other / unclassified",
}
TEST_KINDS = {
    "unit": "Unit / service",
    "integration": "E2E / integration",
    "support": "Test support",
    "fixtures": "Code fixtures",
}
VIEWS = {"components": COMPONENTS, "features": FEATURES, "tests": TEST_KINDS}
STEMS = {
    "components": "repository-component-growth-line",
    "features": "repository-feature-growth",
    "tests": "repository-test-growth",
}
CODE_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte",
    ".css", ".html", ".sh", ".py",
}
SCOPE_NOTE = "Physical lines including blanks/comments; committed files only."
LIMIT_NOTE = "Code volume does not measure coverage, passing tests, quality or productivity."


def local_path(path: str) -> str:
    return path.removeprefix("apps/desktop/")


def is_code_file(path: str) -> bool:
    # Allow only owned source/test/script roots and top-level executable configs.
    # A *.config.ts inside reports, docs or vendor must never bypass this scope.
    if path == "scripts/plot-code-growth.py":
        return False
    path = local_path(path)
    candidate = PurePosixPath(path)
    return candidate.suffix in CODE_SUFFIXES and (
        path == "index.html"
        or path.startswith(("src/", "test/", "tests/", "scripts/"))
        or (candidate.parent == PurePosixPath(".") and ".config." in candidate.name)
    )


def test_kind_for_path(path: str) -> str | None:
    path = local_path(path)
    parts = PurePosixPath(path).parts
    name = parts[-1]
    in_tests = "test" in parts or "tests" in parts
    if in_tests and "fixtures" in parts:
        return "fixtures"
    if in_tests and "support" in parts:
        return "support"
    if ".spec." in name or ".integration.test." in name:
        return "integration"
    if ".test." in name:
        return "unit"
    # Old E2E helpers lived next to specs (app.ts, native-input.ts, etc.).
    if in_tests:
        return "support"
    return None


def component_for_path(path: str) -> str:
    if test_kind_for_path(path):
        return "tests"
    path = local_path(path)
    if path == "index.html":
        return "renderer"
    if path == "src/shared/contracts.ts":
        return "protocol"
    if path.startswith("src/shared/"):
        return "core"
    if path.startswith("src/preview/"):
        return "preview_runtime"
    for folder in (
        "renderer", "main", "core", "protocol", "preload", "launcher",
        "preview-runtime", "browser-runtime", "image-runtime", "image-export-runtime",
        "hwp-runtime",
    ):
        if path.startswith(f"src/{folder}/"):
            return folder.replace("-", "_")
    candidate = PurePosixPath(path)
    if candidate.parent == PurePosixPath("src") and path.endswith(".d.ts"):
        return "types"
    if path.startswith("scripts/") or ".config." in candidate.name:
        return "tooling"
    return "other"


def feature_for_path(path: str) -> str:
    """Assign production files by responsibility, across execution environments.

    This is a path-based ownership approximation, not dependency analysis. Specific
    exceptions precede broad directories; unknown paths remain visible as other.
    """
    path = local_path(path)
    name = PurePosixPath(path).name.lower()
    parts = PurePosixPath(path).parts
    if path == "index.html":
        return "workspace"
    # Locations and language UI moved out of browser/editor during the cleanup.
    if name in {"locationbar.svelte", "locationsuggestions.svelte"}:
        return "workspace"
    if "source-control" in parts or name.startswith(("git-", "review-", "rendered-diff")):
        return "git"
    if "language" in parts or name.startswith("language"):
        return "language"
    if "notebook" in parts or name.startswith(("notebook", "kernel-")):
        return "notebook"
    if "browser" in parts or "browser-runtime" in parts or name.startswith("browser"):
        return "browser"
    if "hwp" in parts or "hwp-runtime" in parts:
        return "hwp"
    if any(p in parts for p in ("image", "pdf", "video", "image-runtime", "image-export-runtime")):
        return "media"
    if path.startswith("src/main/documents/") and name.startswith(("image-", "pdf-", "video-")):
        return "media"
    if "terminal" in parts or name.startswith("terminal"):
        return "terminal"
    if "theme" in parts or name.startswith(("theme", "vscode-theme")) or name == "style.css":
        return "theme"
    if "diff" in parts:
        return "git"
    if any(p in parts for p in ("preview", "preview-runtime", "reader", "reading", "markdown")):
        return "reading"
    if name.startswith(("preview-", "source-anchor", "viewport-anchor", "render-worker", "markdown-link")) or name == "readersurface.svelte":
        return "reading"
    if "editor" in parts or name.startswith(("editor-", "markdown-insertion", "monaco")) or name == "insertiondialogs.svelte":
        return "editor"
    if "project" in parts or "search" in parts or name == "explorer.ts":
        return "project"
    if any(p in parts for p in (
        "workspace", "documents", "document", "tabs", "groups", "app", "application",
        "shell", "windows", "menu", "settings",
    )):
        return "workspace"
    if name in {
        "app.svelte", "main.ts", "application-menu.ts", "window-state.ts",
        "document-manager.ts", "document-state.ts", "draft-assets.ts", "file-system.ts",
        "pasted-image.ts", "tab-drag.ts", "view-state.svelte.ts", "ui-command.ts",
        "applicationmenu.svelte", "emptystate.svelte", "menuitems.svelte",
        "tabchrome.svelte", "titlebar.svelte",
    }:
        return "workspace"
    if any(p in parts for p in ("protocol", "preload", "launcher", "ipc", "ports", "adapters")) or name.endswith(".d.ts"):
        return "shared"
    if name in {"contracts.ts", "text-edit.ts", "zoom.ts", "wheel-zoom.ts", "zoom-state.svelte.ts", "zoomcontrols.svelte"}:
        return "shared"
    return "other"


def snapshot(commit: str, counter: BlobLineCounter, *, include_files: bool = False) -> dict:
    result = {
        "lines": 0, "production": 0, "testing": 0, "tooling": 0,
        **{view: dict.fromkeys(labels, 0) for view, labels in VIEWS.items()},
    }
    files = []
    for sha, path in code_blobs(commit):
        if not is_code_file(path):
            continue
        lines = counter.lines(sha)
        component = component_for_path(path)
        kind = test_kind_for_path(path)
        category = "testing" if kind else "tooling" if component == "tooling" else "production"
        feature = feature_for_path(path) if category == "production" else ""
        result["lines"] += lines
        result[category] += lines
        result["components"][component] += lines
        if kind:
            result["tests"][kind] += lines
        if feature:
            result["features"][feature] += lines
        if include_files:
            files.append({
                "path": path, "blob": sha, "lines": lines, "category": category,
                "component": component, "feature": feature, "test_kind": kind or "",
            })
    if include_files:
        result["files"] = files
    return result


def commit_history(ref: str = DEFAULT_REF) -> list[dict]:
    """Resolve one immutable tip and enumerate its first-parent snapshots."""
    tip = git_text("rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}").strip()
    rows = git_text(
        "log", "--first-parent", "--reverse", "--format=%H%x09%cI%x09%s", tip,
    ).splitlines()
    records = []
    for row in rows:
        commit, committed_at, subject = row.split("\t", 2)
        records.append({"commit": commit, "time": datetime.fromisoformat(committed_at), "subject": subject})
    return records


def history(ref: str = DEFAULT_REF) -> list[dict]:
    records = commit_history(ref)
    with BlobLineCounter() as counter:
        for index, record in enumerate(records):
            record.update(snapshot(record["commit"], counter, include_files=index == len(records) - 1))
    for index, record in enumerate(records):
        record["elapsed_hours"] = (record["time"] - records[0]["time"]).total_seconds() / 3600
        record["delta"] = record["lines"] - (records[index - 1]["lines"] if index else 0)
    return records


def provenance(records: list[dict], ref: str) -> str:
    last = records[-1]
    return f"{ref} / first-parent / {len(records)} commits / {last['commit'][:12]} / {last['time'].isoformat()}"


def write_csv(records: list[dict], output: Path, view: str | None = None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    columns = list(VIEWS[view]) if view else ["production", "testing", "tooling", "delta"]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["commit", "committed_at", "elapsed_hours", "total", *columns],
            lineterminator="\n",
        )
        writer.writeheader()
        for record in records:
            values = record[view] if view else {key: record[key] for key in columns}
            total = sum(values.values()) if view else record["lines"]
            writer.writerow({
                "commit": record["commit"], "committed_at": record["time"].isoformat(),
                "elapsed_hours": f"{record['elapsed_hours']:.4f}", "total": total, **values,
            })


def write_audit(records: list[dict], ref: str, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    last = records[-1]
    with (output / "repository-code-growth-files.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["commit", "path", "blob", "lines", "category", "component", "feature", "test_kind"],
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows({"commit": last["commit"], **entry} for entry in last["files"])
    metadata = {
        "schema_version": 1, "ref": ref, "resolved_commit": last["commit"],
        "committed_at": last["time"].isoformat(), "history": "first-parent",
        "commit_count": len(records), "metric": SCOPE_NOTE, "limitations": LIMIT_NOTE,
        "excluded": ["docs", "reports", "vendor gitlinks", "assets", "JSON/data", "lockfiles", "code-growth itself", "uncommitted changes"],
        "feature_scope": "Production source only; path-based responsibility, not dependency analysis",
        "test_scope": "Test source, support and code fixtures; no test execution results",
        "totals": {key: last[key] for key in ("lines", "production", "testing", "tooling")},
        **{view: last[view] for view in VIEWS},
        "unclassified_files": [entry["path"] for entry in last["files"] if entry["component"] == "other" or entry["feature"] == "other"],
    }
    (output / "repository-code-growth-summary.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
