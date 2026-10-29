#!/usr/bin/env python3
import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1]
ledger=json.loads((root/'docs/migrations/2026-10-29.json').read_text())
assert len(ledger['products'])==9
remaining=json.loads((root/'docs/migrations/2026-10-29-remaining.json').read_text())
assert len(remaining['products'])==4
ledger['products'] += remaining['products']
for item in ledger['products']:
 name=item['product'];folder=root/name
 assert sorted(p.name for p in folder.iterdir())==['README.md'],name
 notice=(folder/'README.md').read_text()
 assert item['repository'] in notice and item['commit'] in notice,name
 assert re.fullmatch('[0-9a-f]{40}',item['commit']),name
 assert item['repository'] in (root/'README.md').read_text(),name
assert not list(root.glob('*/package.json'))
assert not list((root/'.github/workflows').glob('*publish*'))
assert 'splitintech/moggridge' in (root/'react-mobile-interactions/README.md').read_text()
print('Thirteen standalone migration notices and the existing Moggridge notice verified.')
