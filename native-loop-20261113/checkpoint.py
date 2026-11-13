"""Save this run's closed evidence to the existing recovery branch."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess
import sys

root = Path('/workspace/pr449-native-loop-20261113')
repo = '/workspace/agentic-mermaid'
branch = 'refs/heads/review/pr449-evidence-20261105'
index = root / ('checkpoint-index-' + datetime.datetime.now().strftime('%H%M%S'))
env = dict(os.environ, GIT_INDEX_FILE=str(index), GIT_NO_LAZY_FETCH='1')

def git(*args, data=None):
    return subprocess.check_output(['git', '-C', repo, '-c', 'gc.auto=0',
        '-c', 'pack.threads=1', '-c', 'pack.windowMemory=16m',
        '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
        '-c', 'credential.useHttpPath=true', *args], input=data, env=env).decode().strip()

assert len(sys.argv) == 3, 'Usage: checkpoint.py EXPECTED_PARENT COMMIT_MESSAGE'
expected, message = sys.argv[1:]
git('fetch', '--filter=blob:none', '--depth=1', 'origin', branch + ':' + branch)
old = git('rev-parse', branch)
assert old == expected, (old, expected)
git('read-tree', old)
files = sorted(p for p in root.rglob('*') if p.is_file() and not p.is_symlink()
    and not any(x in {'.git', 'node_modules', '__pycache__'} for x in p.relative_to(root).parts)
    and not p.name.startswith('checkpoint-index-') and p.name != 'CHECKPOINT.json')
assert all(p.stat().st_size < 95_000_000 for p in files), 'Archive oversized evidence before checkpointing; do not delete it'
hashes = git('hash-object', '-w', '--stdin-paths',
    data=('\n'.join(json.dumps(str(p), ensure_ascii=False) for p in files) + '\n').encode()).splitlines()
assert len(files) == len(hashes)
entries = []
for path, blob in zip(files, hashes):
    name = 'native-loop-20261113/' + path.relative_to(root).as_posix()
    mode = '100755' if path.stat().st_mode & 0o111 else '100644'
    entries.append(f'{mode} {blob}\t{name}\0')
git('update-index', '-z', '--add', '--index-info', data=''.join(entries).encode())
tree = git('write-tree', '--missing-ok')
commit = git('commit-tree', tree, '-p', old, '-m', message)
git('update-ref', branch, commit, old)
git('push', 'origin', branch + ':' + branch)
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'parent': old, 'evidence': commit, 'source': git('rev-parse', 'HEAD'),
    'files': len(files), 'bytes': sum(p.stat().st_size for p in files),
    'pushed': True, 'excluded': ['dependency/Git caches', 'symlinks', 'checkpoint index/control files']}
(root / 'CHECKPOINT.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
