# Notebook analysis benchmark: baseline

Run of 2026-11-18 at v2.10.1-6-g9381ba1-dirty: 228 notebooks from 28 repositories (19 of 247 skipped), basedpyright 1.40.2, Python 3.13.11. Setdown's default level for notebooks is `off`.

Lines marked red (errors) and yellow (warnings):

| configuration | notebooks with red lines | red lines | errors | yellow lines | warnings | seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **off** (default) | 8 of 228 | 12 | 40 | 660 | 839 | 109 |
| basic | 173 of 228 | 1546 | 2178 | 251 | 278 | 87 |
| standard | 175 of 228 | 1597 | 2233 | 251 | 278 | 86 |
| strict | 207 of 228 | 13195 | 25341 | 26 | 29 | 90 |
| analyzer | 176 of 228 | 1798 | 2471 | 252 | 279 | 126 |
| declared | 166 of 228 | 1486 | 2062 | 251 | 278 | 84 |
| basic-without-sklearn-stubs | 173 of 228 | 1669 | 2362 | 251 | 278 | 109 |
| basic-with-sympy-stubs | 173 of 228 | 1546 | 2178 | 251 | 278 | 89 |

Red lines by cause, with yellow lines in parentheses:

| configuration | syntax | undefined name | unresolved import | type |
| --- | ---: | ---: | ---: | ---: |
| off | 12 (0) | 0 (405) | 0 (254) | 0 (1) |
| basic | 12 (0) | 405 (0) | 228 (26) | 905 (225) |
| standard | 12 (0) | 405 (0) | 228 (26) | 957 (225) |
| strict | 12 (0) | 405 (0) | 228 (26) | 12991 (0) |
| analyzer | 17 (0) | 425 (0) | 228 (26) | 1133 (226) |
| declared | 12 (0) | 415 (0) | 228 (26) | 835 (225) |
| basic-without-sklearn-stubs | 12 (0) | 405 (0) | 228 (26) | 1028 (225) |
| basic-with-sympy-stubs | 12 (0) | 405 (0) | 228 (26) | 905 (225) |

Of the 78 lines judged by hand in labels.json, how many each configuration marks red:

| configuration | real problems | hazards | false reports | real share of marked |
| --- | ---: | ---: | ---: | ---: |
| off | 0 of 6 | 0 of 1 | 0 of 71 | – |
| basic | 4 of 6 | 1 of 1 | 59 of 71 | 6% |
| standard | 4 of 6 | 1 of 1 | 59 of 71 | 6% |
| strict | 4 of 6 | 1 of 1 | 67 of 71 | 6% |
| analyzer | 6 of 6 | 1 of 1 | 65 of 71 | 8% |
| declared | 4 of 6 | 1 of 1 | 54 of 71 | 7% |
| basic-without-sklearn-stubs | 6 of 6 | 1 of 1 | 71 of 71 | 8% |
| basic-with-sympy-stubs | 4 of 6 | 1 of 1 | 59 of 71 | 6% |

Analysis environment: beautifulsoup4 4.15.0, diffusers 0.29.0, geopandas 1.1.2, graphviz 0.21, httpx 0.28.1, huggingface-hub 1.26.1, imageio 2.37.2, ipython 9.7.0, jinja2 3.1.6, joblib 1.5.3, matplotlib 3.10.8, nest-asyncio 1.6.0, numba 0.67.0, numpy 2.4.0, openai 3.49.0, opencv-python 4.13.0.92, packaging 25.0, pandas 2.3.3, patsy 1.0.3, pillow 12.1.0, protobuf 7.34.1, psutil 7.0.0, pytest 9.1.1, python-dotenv 1.2.1, pytz 2025.2, requests 2.32.5, safetensors 0.5.3, scikit-image 0.26.0, scikit-learn 1.8.0, scipy 1.17.0, seaborn 0.13.2, sentencepiece 0.2.1, setuptools 80.9.0, shapely 2.1.2, spacy 3.8.14, statsmodels 0.15.0, tokenizers 0.22.2, torch 2.11.0, torchvision 0.26.0+cu130, tqdm 4.67.1, transformers 5.2.0, xarray 2026.9.0.

Imported by the notebooks but not installed: anthropic, cartopy, cerebras, dask, datasets, distributed, dtreeviz, evaluate, fastai, fastbook, flax, folium, geodatasets, ipytest, ipywidgets, jax, jiwer, kaggle, keras, keras_hub, langchain, langfuse, libpysal, llama_index, mapclassify, matplotlib_map_utils, matplotlib_scalebar, mediapy, mlflow, nltk, openinference, optax, pandas_datareader, parallel, phoenix, portpicker, psycopg2, pyprind, rasterio, skdemo, smolagents, tenacity, tensorflow, tensorflow_datasets, tensorflow_docs, tensorflow_hub, tf_keras, tiktoken, torchtext, treeinterpreter, ultralytics, urlextract, voyageai, wandb, waterfall_chart, wget, zarr.
