def _setdown_inspect(name=None, offset=0):
    """Bounded previews of common scientific values, evaluated only on request."""
    import itertools
    namespace = get_ipython().user_ns
    def text(value):
        if value is None or type(value) in (str, int, float, bool):
            return str(value)[:300]
        return '<' + type(value).__name__ + '>'
    def shape(value):
        if type(value).__module__.split('.')[0] in ('pandas', 'numpy'):
            return str(getattr(value, 'shape', ''))
        if type(value) in (list, tuple, dict, set, str): return str(len(value))
        return ''
    if name is None:
        return {'variables': [{'name': key, 'type': type(value).__name__, 'shape': shape(value), 'preview': text(value)}
            for key, value in itertools.islice(((key, value) for key, value in namespace.items()
                if not key.startswith('_') and key not in ('In', 'Out', 'get_ipython', 'exit', 'quit', 'open')), 500)]}
    if not isinstance(name, str) or not name.isidentifier() or name not in namespace: raise ValueError('Variable is no longer available')
    value = namespace[name]
    offset = max(0, min(int(offset), 10000000))
    module, kind = type(value).__module__.split('.')[0], type(value).__name__
    if module == 'pandas' and kind == 'DataFrame':
        frame = value.iloc[offset:offset + 100, :100]
        return {'columns': ['index'] + [str(c)[:100] for c in frame.columns],
                'rows': [[text(i)] + [str(v)[:100] for v in row] for i, row in zip(frame.index, frame.itertuples(index=False, name=None))], 'total': len(value)}
    if module == 'numpy' and kind == 'ndarray':
        flat = value.flat
        return {'columns': ['flat index', 'value'], 'rows': [[str(i), str(flat[i])[:300]] for i in range(offset, min(offset + 100, value.size))], 'total': int(value.size)}
    if type(value) is dict:
        return {'columns': ['key', 'value'], 'rows': [[text(k), text(v)] for k, v in itertools.islice(value.items(), offset, offset + 100)], 'total': len(value)}
    if type(value) in (list, tuple):
        return {'columns': ['index', 'value'], 'rows': [[str(i), text(v)] for i, v in enumerate(value[offset:offset + 100], offset)], 'total': len(value)}
    return {'columns': ['value'], 'rows': [[text(value)]], 'total': 1}
