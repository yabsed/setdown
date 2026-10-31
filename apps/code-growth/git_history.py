"""Read Git snapshots with one cached line count per unique file blob."""

from __future__ import annotations

import subprocess
from contextlib import AbstractContextManager
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8", errors="replace")


def code_blobs(commit: str):
    """Yield blob IDs and unquoted paths, including paths containing newlines."""
    for entry in git_bytes("ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        _mode, kind, sha = metadata.decode("ascii").split()
        if kind == "blob":
            yield sha, raw_path.decode("utf-8", errors="surrogateescape")


class BlobLineCounter(AbstractContextManager["BlobLineCounter"]):
    """Keep one cat-file process; unchanged files reuse their blob's count."""

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
        count = len(self.blob(sha).splitlines())
        self.cache[sha] = count
        return count

    def blob(self, sha: str) -> bytes:
        """Read a blob through the existing batch process without caching bytes."""
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("git cat-file batch process is unavailable")
        self.process.stdin.write(f"{sha}\n".encode("ascii"))
        self.process.stdin.flush()
        header = self.process.stdout.readline().decode("ascii", errors="replace").strip()
        parts = header.split()
        if len(parts) != 3 or parts[1] != "blob":
            raise RuntimeError(f"unexpected git cat-file response for {sha}: {header}")
        size = int(parts[2])
        content = self.process.stdout.read(size)
        if len(content) != size or self.process.stdout.read(1) != b"\n":
            raise RuntimeError(f"incomplete git blob {sha}")
        return content
