# Setdown code growth

This small Python application measures physical lines of code across Git history and
renders repository growth charts.

Run it from the repository root to update all growth outputs under `output/`:

```bash
npm run plot:code-growth
```

The command now produces:

- `repository-code-growth.png` and `repository-code-growth-detailed.png` for total code growth.
- `repository-component-growth-line.png` for component-by-component LOC growth.
- `repository-component-growth-line.csv` with the source data for the component chart.

The component chart follows `main` first-parent history by default and measures every
commit. It classifies both the current monorepo paths and their pre-refactor equivalents
into the same semantic groups so directory moves do not appear as artificial growth:

- Tests
- Renderer
- Main
- Core
- Preview runtime
- Tooling
- Protocol
- Preload
- Legacy / other

Docs, vendor content, assets, lockfiles, and the code-growth analysis tool itself are
excluded. Test/spec paths take precedence over architectural component paths.

Run only the component plot with:

```bash
npm run build:components --workspace @setdown/code-growth
```

Use another ref or output path when needed:

```bash
python3 apps/code-growth/plot-component-growth.py \
  --ref main \
  --output /tmp/component-growth.png \
  --data-output /tmp/component-growth.csv
```

It requires Python 3 and Matplotlib.
