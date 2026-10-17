#!/usr/bin/env python3
"""Offline, deterministic import. Python 3.11+ is needed only by maintainers."""
import hashlib
import json
import pathlib
import re
import sys
import tomllib
from urllib.parse import unquote

BASE = pathlib.Path(__file__).resolve().parent
DATA = BASE / 'language-profiles'
DEST = BASE.parent / 'src/main/language/catalog/profiles.json'


def generate():
    sources = json.loads((DATA / 'sources.json').read_text())
    raw = (DATA / 'upstream/helix-languages.toml').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == sources['helix']['sha256'], 'Helix checksum mismatch'
    catalog = json.loads((DEST.parent / 'mason.json').read_text())
    assert all(catalog[k] == v for k, v in sources['mason'].items()), 'Mason snapshot mismatch'
    helix = tomllib.loads(raw.decode())
    overrides = json.loads((DATA / 'overrides.json').read_text())
    packages = {p['id']: p for p in catalog['packages']}
    languages = {l['name']: l for l in helix['language']}
    associations = {name: [] for name in helix['language-server']}
    for language in languages.values():
        for server in language.get('language-servers', []):
            name = server if isinstance(server, str) else server['name']
            if name in associations:
                associations[name].append(language)
    for name, names in overrides['associations'].items():
        associations[name] = [languages[n] for n in ([names] if isinstance(names, str) else names)]

    def expand(pattern):
        match = re.search(r'\{([^{}]+)\}', pattern)
        if match:
            return [p for part in match[1].split(',') for p in expand(pattern[:match.start()] + part + pattern[match.end():])]
        return [pattern]

    profiles, excluded = {}, []
    for name, server in helix['language-server'].items():
        if name in {'cs', 'mojo-lsp-server', 'godot'}:
            excluded.append({'profile': name, 'reason': overrides['manual'][name]})
            continue
        matches = [p for p in packages.values() if server['command'] in p['executables']]
        identity = overrides['aliases'].get(name) or (name if name in packages else matches[0]['id'] if len(matches) == 1 else name)
        # Different commands/arguments are separate profiles even if Mason ships them together.
        if identity in profiles or (identity != name and identity in helix['language-server']):
            identity = name
        assert identity not in profiles, f'Duplicate connection identity: {identity}'
        package = packages.get(identity)
        # When Helix declares a command but no default binding, join only exact
        # language names supplied by Mason; never invent a language ID or arguments.
        if not associations[name] and package:
            names = {label.casefold() for label in package['languages']}
            associations[name] = [language for language in languages.values() if language['name'].casefold() in names]
        routes, skipped = [], []
        for language in associations[name]:
            route = {'languageId': language.get('language-id', language['name']), 'extensions': []}
            for filetype in language.get('file-types', []):
                if isinstance(filetype, str):
                    if re.fullmatch(r'[\w.+-]+', filetype):
                        field = 'caseSensitiveExtensions' if any(c.isupper() for c in filetype) else 'extensions'
                        route.setdefault(field, []).append('.' + filetype)
                    else:
                        skipped.append(filetype)
                else:
                    for pattern in expand(filetype['glob']):
                        if pattern.startswith('/') or '..' in pattern.split('/') or not re.fullmatch(r'[\w .+@/?!*_-]+', pattern):
                            skipped.append(pattern)
                        else:
                            field = 'filenamePatterns' if any(c in pattern for c in '/*?') else 'filenames'
                            route.setdefault(field, []).append(pattern)
            if any(route.get(k) for k in ['extensions', 'caseSensitiveExtensions', 'filenames', 'filenamePatterns']):
                # Uppercase-only associations must still be representable by the validator.
                if not route['extensions'] and not route.get('filenames') and not route.get('filenamePatterns'):
                    route['extensions'] = route.pop('caseSensitiveExtensions')
                if route['languageId'] in overrides['monacoIds']:
                    route['monacoId'] = overrides['monacoIds'][route['languageId']]
                routes.append(route)
        if not routes:
            excluded.append({'profile': name, 'reason': 'No file associations in the pinned source.'})
            continue
        package = packages.get(identity)
        source = package.get('source', {}).get('id', '') if package else ''
        npm = unquote(source[len('pkg:npm/'):].rsplit('@', 1)[0]) if source.startswith('pkg:npm/') else None
        markers = sorted({r for l in associations[name] for r in l.get('roots', []) if '/' not in r and '\\' not in r and r != '..'})
        note = overrides['manual'].get(name)
        # Keep the existing Markdown-only no-LSP guarantee. Auxiliary providers cannot
        # displace the primary code server until multiple-server feature routing exists.
        auxiliary = name in {'ruff', 'golangci-lint-lsp', 'vscode-eslint-language-server', 'tailwindcss-ls', 'harper-ls', 'ltex-ls', 'ltex-ls-plus', 'vale-ls', 'rumdl', 'pytest-language-server', 'zizmor', 'oxlint-language-server', 'oxfmt-language-server'}
        if auxiliary:
            note = note or 'Optional diagnostics or formatting provider. Enable explicitly to use it as the primary server.'
        if any(r['languageId'] in {'markdown', 'git-commit'} for r in routes):
            note = note or 'Optional writing support. Enable explicitly; Markdown editing does not start a server by default.'
        definition = {'id': identity, 'name': identity, 'enabledByDefault': not bool(note), 'automatic': True,
                      'languages': routes, 'launch': {'kind': 'native', 'command': server['command'], 'args': [arg.replace('--client-id=helix', '--client-id=setdown') for arg in server.get('args', [])]},
                      'rootMarkers': markers, 'settings': {}, 'watchExtensions': sorted({e for r in routes for e in r['extensions']}),
                      'watchFiles': markers, 'provenance': {'source': 'Helix', 'revision': sources['helix']['revision'], 'profile': name}}
        if server.get('config'):
            definition['initializationOptions'] = dict(server['config'])
            if definition['initializationOptions'].get('hostInfo') == 'helix':
                definition['initializationOptions']['hostInfo'] = 'setdown'
        # Helix's config is initialization data, not a universal settings schema.
        # These servers document language-scoped workspace settings separately.
        if identity == 'typescript-language-server':
            for language in ('typescript', 'javascript'):
                config = definition.get('initializationOptions', {}).pop(language, None)
                if config is not None:
                    definition['settings'][language] = config
        if identity == 'css-lsp':
            for language in ('css', 'scss', 'less'):
                definition.get('initializationOptions', {}).pop(language, None)
                definition['settings'][language] = {'validate': True, 'lint': {}, 'completion': {}, 'hover': {}}
        if source.startswith('pkg:pypi/'):
            definition['discovery'] = 'python'
        if npm:
            definition['npmPackage'] = npm
        if note:
            definition['setupNote'] = note
        if skipped:
            excluded.append({'profile': name, 'reason': 'Unsupported file patterns', 'patterns': skipped})
        profiles[identity] = definition

    # Small application-policy overrides, not a second handwritten catalog.
    for identity, patch in overrides['profiles'].items():
        original = profiles.get(identity, {})
        inherited = original.get('languages', [])
        original.update(patch)
        combined = {r['languageId']: dict(r) for r in patch.get('languages', [])}
        for route in inherited:
            if route['languageId'] not in combined:
                combined[route['languageId']] = route
            else:
                target = combined[route['languageId']]
                for field in ['extensions', 'caseSensitiveExtensions', 'filenames', 'filenamePatterns']:
                    if field in route:
                        target[field] = list(dict.fromkeys(target.get(field, []) + route[field]))
        original['languages'] = list(combined.values())
        profiles[identity] = original
    # Existing built-ins keep their routing precedence and identity across upgrades.
    ordered = [profiles.pop(i) for i in overrides['profiles']] + [profiles[i] for i in sorted(profiles)]
    covered = {p['id'] for p in ordered}
    coverage = [{'id': p['id'], 'connection': 'profile' if p['id'] in covered else 'manual',
                 'reason': None if p['id'] in covered else 'The pinned sources do not provide a complete stdio connection profile.'} for p in catalog['packages']]
    return {'sources': sources, 'profiles': ordered, 'coverage': coverage, 'excluded': excluded}


def main():
    output = json.dumps(generate(), ensure_ascii=False, indent=2) + '\n'
    if '--check' in sys.argv:
        if not DEST.exists() or DEST.read_text() != output:
            raise SystemExit('Language profiles are stale. Run python3 scripts/update-language-profiles.py.')
    else:
        DEST.write_text(output)
    data = json.loads(output)
    print(f"{len(data['profiles'])} connection profiles; {sum(p['connection'] == 'profile' for p in data['coverage'])}/{len(data['coverage'])} Mason entries mapped; {len(data['excluded'])} import exclusions recorded")

if __name__ == '__main__':
    main()
