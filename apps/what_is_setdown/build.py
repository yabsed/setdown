#!/usr/bin/env python3
"""Build setdown.pdf, a one-page A4 print of readme.md.

Run: python 19-Setdown/build.py
Requires Pandoc, XeLaTeX/ko.TeX, pypdf, and the Pretendard fonts in 14-bmw/assets.
Edit readme.md for the text and print/template.tex for the layout.
"""

from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
FONTS = ROOT.parent / "14-bmw/assets/fonts/Pretendard"

# How each readme image is set on paper. The two screenshots print as one
# diagonal light/dark split (print/hero.png), so the dark one is dropped here.
PRINT = {
    "readme.assets/history.png":
        r"\logorow{\logocell{markdown}{8mm}{2004}\logocell{jupyter}{12mm}{2014}}",
    "readme.assets/three-products.png":
        r"\logorow{\logocell{markdown}{8mm}{EDITOR}"
        r"\logocell{firefox}{11.5mm}{BROWSER}\logocell{vscode}{10.5mm}{WORKBENCH}}",
    "readme.assets/setdown-light.png": r"\hero{hero}",
    "readme.assets/setdown-dark.png": "",
}
IMAGE = re.compile(r"^!\[[^\]]*\]\(<?([^)>]+)>?\)[ \t]*$", re.MULTILINE)


def to_latex(match):
    path = match.group(1)
    if path not in PRINT:
        raise SystemExit(f"No print layout for image {path}; add it to PRINT in build.py.")
    return f"```{{=latex}}\n{PRINT[path]}\n```" if PRINT[path] else ""


def main():
    for executable in ("pandoc", "xelatex"):
        if not shutil.which(executable):
            raise SystemExit(f"Required executable not found: {executable}")
    body = IMAGE.sub(to_latex, (ROOT / "readme.md").read_text(encoding="utf-8"))
    body = body.replace(" …", "\u00a0…")  # keep an ellipsis on the line before it

    with tempfile.TemporaryDirectory(prefix="setdown-print-") as temporary:
        work = Path(temporary)
        subprocess.run([
            "pandoc", "--from=markdown", "--standalone",
            f"--template={ROOT / 'print/template.tex'}",
            f"--variable=fontpath:{FONTS}", f"--variable=assetpath:{ROOT / 'print'}",
            "--variable=title:Setdown", "--variable=link:github.com/yabsed/setdown",
            "--metadata=lang:en", "--metadata=pagetitle:Setdown",
            "--output", str(work / "setdown.tex"),
        ], input=body, text=True, check=True)
        result = subprocess.run([
            "xelatex", "-interaction=nonstopmode", "-halt-on-error",
            f"-output-directory={work}", str(work / "setdown.tex"),
        ], capture_output=True, text=True)
        if result.returncode:
            print(result.stdout[-6000:])
            result.check_returncode()

        log = (work / "setdown.log").read_text(encoding="utf-8")
        problems = [line for line in log.splitlines()
                    if "Overfull" in line or "Missing character" in line]
        if problems:
            raise SystemExit("Layout or font errors:\n" + "\n".join(problems))
        pages = len(PdfReader(work / "setdown.pdf").pages)
        if pages != 1:
            raise SystemExit(f"Expected one page, got {pages}; adjust print/template.tex.")
        shutil.copyfile(work / "setdown.pdf", ROOT / "setdown.pdf")
    print(f"Created {ROOT / 'setdown.pdf'} (1 page)")


if __name__ == "__main__":
    main()
