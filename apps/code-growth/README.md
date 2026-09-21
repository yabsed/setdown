# Setdown code growth

This small Python application measures physical lines of code from Git history and renders
repository growth charts.

Run it from the repository root:

```bash
npm run plot:code-growth
```

It requires Python 3 and Matplotlib.

## Outputs

- `output/repository-code-growth.png`: total physical LOC and per-commit deltas.
- `output/repository-code-growth-detailed.png`: detailed total-growth view.
- `output/repository-component-growth.png`: dark presentation-style component growth chart.
- `output/repository-component-growth.json`: first-parent component snapshots used by the chart.

The component view follows `main`'s first-parent history and measures real snapshots rather
than summing diffs. It excludes documentation, vendor trees, lockfiles, assets, and the
code-growth analysis app itself.

Current source is grouped into:

- Tests
- Renderer
- Main
- Core
- Preview runtime
- Tooling
- Protocol
- Preload
- Legacy / other

Tests are classified first, so test/spec files under otherwise product-specific directories
remain part of the Tests series. Older source layouts that do not match the current
architecture naturally appear under Legacy / other and can fall back to zero after a
refactor.

To render only the component chart:

```bash
npm run build:components --workspace @setdown/code-growth
```

The Python script also accepts a different Git ref:

```bash
python3 apps/code-growth/plot-component-growth.py --ref HEAD
```
