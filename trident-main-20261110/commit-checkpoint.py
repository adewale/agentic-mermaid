"""Commit a recovery packet through an alternate index, preserving source state."""
import json
import os
import subprocess
import sys
from pathlib import Path

stage = sys.argv[1]
assert stage in ['svg-complete', 'final']
repo = Path('/tmp/pr449-main-integration-20261029-762')
packet = Path('/tmp/pr449-trident-main-checkpoints-20261111') / stage
assert (packet / 'MANIFEST.json').exists()
branch = 'refs/heads/review/pr449-evidence-20261105'
index = packet.parent / ('git-index-' + stage)
assert not index.exists(), 'Preserve the previous recovery index; choose a fresh attempt explicitly'
env = {**os.environ, 'GIT_INDEX_FILE': str(index)}
def git(*args, input=None):
    return subprocess.check_output(['git', '-c', 'gc.auto=0', '-C', str(repo), *args], input=input, text=True, env=env).strip()
old = git('rev-parse', branch)
git('read-tree', old)
entries = []
for file in sorted(packet.rglob('*')):
    if not file.is_file():
        continue
    blob = git('hash-object', '-w', '--', str(file))
    entries.append('100644 ' + blob + '\ttrident-main-20261110/' + str(file.relative_to(packet)))
git('update-index', '--add', '--index-info', input='\n'.join(entries) + '\n')
tree = git('write-tree')
commit = git('commit-tree', tree, '-p', old, '-m',
             ('Checkpoint complete 33-family Main/PR Native and ELK SVG observations'
              if stage == 'svg-complete' else 'Report frozen Main/PR Native and ELK correctness and execution costs'))
git('update-ref', branch, commit, old)
source_env = {k: v for k, v in os.environ.items() if k != 'GIT_INDEX_FILE'}
source_status = subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain'], text=True, env=source_env).strip()
result = {'stage': stage, 'previousEvidence': old, 'evidence': commit, 'packet': str(packet),
          'sourceHead': git('rev-parse', 'HEAD'), 'sourceStatus': source_status, 'pushed': False}
destination = Path(__file__).parent / ('RECOVERY-' + stage + '.json')
destination.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
