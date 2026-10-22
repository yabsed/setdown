"""Validate the actual NotebookDocument output written by reproduction F15."""
import json
from pathlib import Path
import nbformat

print(f"nbformat {nbformat.__version__}", flush=True)
document = json.loads(Path(__file__).with_name("converted-code-cell.ipynb").read_text())
nbformat.validate(document)
