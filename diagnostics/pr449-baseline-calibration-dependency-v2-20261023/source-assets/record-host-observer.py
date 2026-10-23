"""Descriptive snapshots outside benchmark windows; never a timing correction."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import time

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
parser.add_argument('--phase', choices=['before', 'after'], required=True)
args = parser.parse_args()
paths = ['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu.stat',
         '/sys/fs/cgroup/cpu.pressure', '/sys/fs/cgroup/memory.max',
         '/proc/loadavg']
record = {'protocol': 'external-host-snapshot@1', 'phase': args.phase,
          'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'monotonicSeconds': time.monotonic(), 'files': {},
          'interpretation': 'Shared host/cgroup context only. Not per-worker attribution, a causal diagnosis, CPU normalization or replacement for wall controls.'}
for path in paths:
    try:
        raw = Path(path).read_bytes()
        record['files'][path] = {'content': raw.decode('utf8'),
                                 'sha256': hashlib.sha256(raw).hexdigest()}
    except OSError as error:
        record['files'][path] = {'unavailable': str(error)}
with Path(args.out).open('x') as stream:
    json.dump(record, stream, indent=2)
    stream.write('\n')
print(json.dumps({'phase': args.phase, 'out': args.out}))
