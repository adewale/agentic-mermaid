# PR449 selected primary evidence

[The report](pr449-frontier-2026-10-23.md) separates current integration checks from historical performance and quality measurements. Its [structured companion](pr449-frontier-2026-10-23.json) binds the report and [evidence packet](pr449-frontier-2026-10-23-evidence.json.gz) by SHA256.

The packet is standard gzip containing UTF-8 JSON. Each `entries` item includes an original file's complete `content`, `relativePath`, byte count and SHA256. The manifest repeats the entry identities. Original bytes and failed, missing, unlaunched and unverified results are retained; collection does not rerun experiments or turn a failed prototype into an accepted optimization.

This is selected primary evidence: assessments, prospective targets, plans, independent reviews, failure ledgers, source patches and integration checks. It generally excludes complete raw worker datasets, full SVG/layout oracle payloads, runtime artifacts, profiles and dependency trees. Original included files retain hashes and workspace provenance for omitted data. Those pointers do not promise public downloads or establish present availability.

Verify the packet without executing its contents:

```python
import gzip
import hashlib
import json
from pathlib import Path

root = Path('docs/design/system')
report = json.loads((root / 'pr449-frontier-2026-10-23.json').read_text())
raw = (root / 'pr449-frontier-2026-10-23-evidence.json.gz').read_bytes()
assert hashlib.sha256(raw).hexdigest() == report['sealedPublication']['packetSha256']
packet = json.loads(gzip.decompress(raw))
manifest = {item['relativePath']: item for item in packet['manifest']}
assert len(manifest) == len(packet['entries'])
for entry in packet['entries']:
    content = entry['content'].encode('utf-8')
    identity = manifest[entry['relativePath']]
    assert len(content) == entry['bytes'] == identity['bytes']
    assert hashlib.sha256(content).hexdigest() == entry['sha256'] == identity['sha256']
assert hashlib.sha256((root / 'pr449-frontier-2026-10-23.md').read_bytes()).hexdigest() == report['markdownSha256']
```

The gzip stream uses `mtime=0`. A particular original can be inspected through `entry['content']` or saved with `Path(...).write_bytes(entry['content'].encode('utf-8'))`. This packet uses plain JSON, unlike the older interned evidence archives; it needs no repository-specific decoder.

The report and packet are a dated snapshot. Performance admission, new experiments and remote CI can advance independently afterward. Current build, correctness and transfer checks do not qualify historical memory ratios as measurements of the current runtime.
