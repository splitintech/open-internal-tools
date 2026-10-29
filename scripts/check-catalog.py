#!/usr/bin/env python3
"""Validate the standalone product catalog and retained historical records offline."""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
products = json.loads((root / 'docs/catalog.json').read_text())['products']
readme = (root / 'README.md').read_text()
index = (root / 'docs/migrations/README.md').read_text()
repositories = {item['repository'] for item in products}
folders = {item['former_directory'] for item in products}
assert len(products) == len(repositories) == len(folders) == 14

for item in products:
    name = item['former_directory']
    assert not (root / name).exists(), f'Retired product folder reintroduced: {name}'
    assert re.fullmatch(r'https://github.com/splitintech/[a-z0-9-]+', item['repository'])
    assert item['documentation'] == item['repository'] + '#readme'
    assert item['repository'] in readme and item['documentation'] in readme, name
    assert item['historical_source'] in index, name
    assert re.fullmatch(r'[0-9a-f]{40}', item['migration_commit']), name
    assert re.fullmatch(
        r'https://github.com/splitintech/open-internal-tools/tree/[0-9a-f]{40}/' + re.escape(name),
        item['historical_source'],
    ), name

historical = []
for filename, count in [('2026-10-29.json', 9), ('2026-10-29-remaining.json', 4)]:
    ledger = json.loads((root / 'docs/migrations' / filename).read_text())
    assert len(ledger['products']) == count
    historical.extend(ledger['products'])
assert {item['product'] for item in historical} == folders - {'react-mobile-interactions'}
for item in historical:
    current = next(p for p in products if p['former_directory'] == item['product'])
    assert item['repository'] == current['repository']
    assert item['commit'] == current['migration_commit']
    assert item['source_commit'] in current['historical_source']

protection = json.loads((root / 'docs/repository-protection.json').read_text())['repositories']
assert len(protection) == 14
assert {item['url'] for item in protection} == repositories
for item in protection:
    assert item['enforcement'] == 'active' and item['bypass_actors'] == []
    assert item['conditions'] == {'ref_name': {'include': ['~DEFAULT_BRANCH'], 'exclude': []}}
    assert item['ruleset_id'] > 0
    assert item['ruleset_url'] == item['url'] + '/rules/' + str(item['ruleset_id'])
    rules = {rule['type']: rule for rule in item['rules']}
    assert {'deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'} <= rules.keys()
    status = rules['required_status_checks']['parameters']
    assert status['strict_required_status_checks_policy'] is True
    assert status['required_status_checks']
    for check in status['required_status_checks']:
        assert check['integration_id'] == 15368
        assert check['context'] not in {'publish', 'Dependabot'}

assert not list(root.glob('*/package.json')), 'Product manifests do not belong in the hub'
for name in ['assert-release-tag.mjs', 'create-release-tag.sh', 'oidc-npm-publish.mjs']:
    assert not (root / 'scripts' / name).exists(), f'Retired release helper: {name}'
assert {p.name for p in (root / '.github/workflows').iterdir()} == {'catalog.yml'}

# Keep documentation navigable after removing the old README-only directories.
for document in root.rglob('*.md'):
    if '.git' in document.parts:
        continue
    source = document.read_text()
    targets = re.findall(r'\]\(([^)]+)\)', source) + re.findall(r'<img[^>]+src="([^"]+)"', source)
    for target in targets:
        path = target.split('#', 1)[0]
        if not path or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', path):
            continue
        assert (document.parent / path).exists(), f'Broken local link: {document.relative_to(root)} -> {target}'

print('14 catalog entries, historical sources, protection records and documentation links verified; no retired product folders or release helpers remain.')
