# PR449 current measurements: evidence coverage

The [report](pr449-current-measurements-2026-10-23.md) and [structured companion](pr449-current-measurements-2026-10-23.json) describe a dated snapshot. The [packet](pr449-current-measurements-2026-10-23-evidence.json.gz) is standard gzip containing UTF8 JSON: 13,762,274 compressed bytes, 106,714,286 JSON bytes and 1,485 complete entries. Each entry contains its original `content`, provenance, SHA256 and byte count. Its manifest repeats these identities.

It includes all 30 dirty-bilayer worker records with 6,750 prewarm/timed calls, all 66 diagnostic worker results, four complete hosted master reports, and the constructor plan, execution ledger and all 126 actual results. Failed targets, noisy controls and the independent audits remain. The constructor plans' original unlaunched status describes their declaration time; the completed trial is separately recorded as rejected. Bounded counting's first over-cap build and C2-R's adverse crossing witness are included. Unfinished later experiments are not represented as completed results.

Whole duplicate JSONL/per-arm files are omitted only after equality checks against retained canonical records. Other omissions include complete SVG/receipt stores, executable/dependency trees, raw profiler bodies, images and both large frame-summary bodies. The explicit omission inventory contains 3,771 records; 8,720 unique reference records retain path/hash contexts. No selected original is truncated or filtered to successful cases. Full rendered-value fidelity therefore relies on the original source-bound assessments and hashes, not on every rendered value being present here. Workspace provenance pointers do not promise public availability.

An earlier complete workspace archive remains separately identified at SHA256 `9d6fc3f67ad6af41ff12c3dfbf32317c773eadc565914fe85b16e05d49793b93`; its dated contents precede the completed constructor trial. The older published frontier packet remains unchanged. Neither archive is relabelled as the new packet.

Verify without executing any packet content:

```python
import gzip
import hashlib
import json
from pathlib import Path

root = Path('docs/design/system')
report = json.loads((root / 'pr449-current-measurements-2026-10-23.json').read_text())
raw = (root / 'pr449-current-measurements-2026-10-23-evidence.json.gz').read_bytes()
assert hashlib.sha256(raw).hexdigest() == report['sealedPublication']['packetSha256']
packet = json.loads(gzip.decompress(raw))
manifest = {item['relativePath']: item for item in packet['manifest']}
assert len(manifest) == len(packet['entries']) == 1485
for entry in packet['entries']:
    content = entry['content'].encode('utf-8')
    identity = manifest[entry['relativePath']]
    assert len(content) == entry['bytes'] == identity['bytes']
    assert hashlib.sha256(content).hexdigest() == entry['sha256'] == identity['sha256']
assert hashlib.sha256((root / 'pr449-current-measurements-2026-10-23.md').read_bytes()).hexdigest() == report['markdownSha256']
for entry in report['supplementalOriginals']:
    content = entry['content'].encode('utf-8')
    assert len(content) == entry['bytes']
    assert hashlib.sha256(content).hexdigest() == entry['sha256']
```

The collector and independent readback check complete populations, all entry hashes, exact UTF8 roundtrips, deterministic gzip and `mtime=0`. Root independently rechecks the archive SHA and all 1,485 entry/manifest identities. Mutable final reports are excluded from the packet to avoid circular hashes. Hosting provenance, measurement boundaries, unverified certificates and historical/current source distinctions retain their original limitations.
