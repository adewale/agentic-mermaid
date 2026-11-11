"""After all clocks close, verify measured bytes and source/tool revisions."""
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).parent
assert (root / 'PERFORMANCE-COMPLETED.json').exists()
assert (root / 'RECEIPT-PERFORMANCE-COMPLETED.json').exists()
identity = json.loads((root / 'IDENTITY.json').read_text())
checks, sources, dependency_roots = [], [], []

def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args], text=True).strip()

def check_file(base, entry, scope):
    if not entry.get('sha256'):
        return
    path = Path(base) / entry['path']
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    checks.append({'scope': scope, 'path': str(path), 'sha256': digest,
                   'matched': digest == entry['sha256'] and (entry.get('bytes', len(data)) == len(data))})

for target, artifact in identity['artifacts'].items():
    base = Path(artifact['artifact']['root'])
    sources.append({'target': target, 'head': git(base, 'rev-parse', 'HEAD'), 'expected': identity['sources'][target],
                    'trackedAndUntrackedStatus': git(base, 'status', '--porcelain')})
    for entry in artifact['files']:
        check_file(base, entry, target + ':artifact')
    for node in artifact['dependencies']['nodes']:
        for logical in node.get('logicalRoots', []):
            dependency_roots.append({'logical': logical, 'expectedReal': node['realRoot'],
                'actualReal': str(Path(logical).resolve()), 'matched': Path(logical).resolve() == Path(node['realRoot']).resolve()})
        for entry in node.get('files', []):
            if entry.get('kind') == 'file':
                check_file(node['realRoot'], entry, target + ':dependency:' + node['name'])
for entry in identity['harness']['files']:
    check_file(root / 'kit', entry, 'Trident compiled kit')
tool = Path('/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident')
sources.append({'target': 'Trident', 'head': git(tool, 'rev-parse', 'HEAD'), 'expected': identity['trident'],
                'trackedAndUntrackedStatus': git(tool, 'status', '--porcelain')})
primary = Path('/tmp/pr449-main-integration-20261029-762')
sources.append({'target': 'primary source', 'head': git(primary, 'rev-parse', 'HEAD'), 'expected': identity['sources']['pr'],
                'trackedAndUntrackedStatus': git(primary, 'status', '--porcelain')})
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sources': sources,
          'filesChecked': len(checks), 'mismatches': [c for c in checks if not c['matched']],
          'allSourceHeadsMatch': all(s['head'] == s['expected'] for s in sources),
          'allSourceWorktreesClean': all(not s['trackedAndUntrackedStatus'] for s in sources),
          'dependencyRootMismatches': [r for r in dependency_roots if not r['matched']],
          'checks': checks,
          'collectorHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()
                             if p.is_file() and p.suffix in ['.ts', '.mjs', '.py']}}
(root / 'POSTVERIFY.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k not in ['checks', 'collectorHashes']}))
assert not result['mismatches'] and not result['dependencyRootMismatches'] and result['allSourceHeadsMatch'] and result['allSourceWorktreesClean']
