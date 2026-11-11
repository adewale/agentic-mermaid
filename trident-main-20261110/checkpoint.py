"""Archive this bounded run outside the source diff; run only between clocks."""
import datetime
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

out = Path(__file__).parent
stage = sys.argv[1]
assert stage in ['svg-complete', 'final']
assert (out / 'PERFORMANCE-COMPLETED.json').exists()
if stage == 'final':
    assert (out / 'RECEIPT-PERFORMANCE-COMPLETED.json').exists()
packet = Path('/tmp/pr449-trident-main-checkpoints-20261111') / stage
packet.mkdir(parents=True, exist_ok=False)

# Preserve exact pinned Trident source, without node_modules or .git.
tool = Path('/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident')
tool_tar = packet / 'trident-source.tar'
with tool_tar.open('wb') as f:
    subprocess.run(['git', '-C', str(tool), 'archive', 'f080278e31e4202ca89d524e4ee9e4cf3cbff038'], stdout=f, check=True)
with tarfile.open(packet / 'evidence.tar.gz', 'w:gz', compresslevel=6) as archive:
    archive.add(out, arcname='run')
    archive.add(tool_tar, arcname='tool-source/trident-source.tar')
    for target, checkout in [('main', '/tmp/pr449-bench-main-4260-20261110'), ('pr', '/tmp/pr449-bench-pr-599b-20261110')]:
        archive.add(Path(checkout) / 'dist', arcname='built-artifacts/' + target + '/dist')
    archive.add('/tmp/pr449-week-comparison-20261101/trident-native-elk-df133-20261108/gnu-time', arcname='tools/gnu-time')

for file in out.iterdir():
    if file.is_file() and file.suffix in ['.md', '.json', '.csv', '.ts', '.mjs', '.py', '.svg']:
        shutil.copy2(file, packet / file.name)
for name in ['fidelity/SUMMARY.md', 'fidelity/FAMILY-RESULTS.csv', 'fidelity/RESULTS.json',
             'fidelity/KNOWN-FAILURES.json', 'fidelity/PROOF-UNVERIFIED-AND-ERRORS.json',
             'browser/SUMMARY.md', 'browser/FAMILY-PAYLOAD.csv', 'performance/ENVIRONMENT.json']:
    source = out / name
    if source.exists():
        destination = packet / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
state = Path('/tmp/pr449-correctness-24h-20261030/campaign-state.json')
shutil.copy2(state, packet / 'campaign-state-at-checkpoint.json')
description = ('All5952 serial Trident SVG timing/resource workers complete; full-product receipt timing pending.'
               if stage == 'svg-complete' else 'Completed Native/ELK and frozen-Main comparison; all timing clocks closed.')
(packet / 'CHECKPOINT.md').write_text('# Main/PR Native and ELK comparison\n\n' + description + '\n\n'
    'Source heads and artifact identities are in IDENTITY.json. Source remains599bee58db7cb54293866cc8aa86c887ef93e9a4; Main4260292397d4bca7624a30c34649eb943a5f8e0c. '
    'No production edits or automation restart. The failed setup and worker smoke observations remain retained and excluded. '
    'evidence.tar.gz contains the complete run, exact scoped built artifacts, pinned Trident source and GNUtime. '
    'This is an exploratory measurement, not a calibrated replacement/readiness claim.\n')
manifest = {'stage': stage, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': []}
for file in sorted(packet.rglob('*')):
    if file.is_file():
        data = file.read_bytes()
        manifest['files'].append({'path': str(file.relative_to(packet)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(packet / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'packet': str(packet), 'files': len(manifest['files']),
                  'archiveBytes': (packet / 'evidence.tar.gz').stat().st_size}))
