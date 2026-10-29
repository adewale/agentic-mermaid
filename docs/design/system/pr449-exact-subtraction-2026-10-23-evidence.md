# PR449 exact subtraction: evidence coverage

The [report](pr449-exact-subtraction-2026-10-23.md) and [structured claims](pr449-exact-subtraction-2026-10-23.json) bind two distinct packets. Earlier dated reports and packets remain unchanged. Neither packet promotes a runtime candidate or repairs failed measurement controls.

| Packet | Compressed bytes | Complete original entries | Original bytes | Coverage |
|---|---:|---:|---:|---|
| [Milestone publication variant](pr449-exact-subtraction-2026-10-23-evidence.json.gz) | 25,231,998 | 1,426 | 152,664,080 | All 30 C2-T workers / 6,750 calls, both latest hosted master reports, exactness and rejected-experiment evidence, SCC join, Class first delivery. |
| [Later reliability supplement](pr449-reliability-and-class-2026-10-23-evidence.json.gz) | 9,848,239 | 563 | 70,936,639 | All 24 calibration workers / 10,800 calls; eight RSS probes; complete Class proof metadata; all 48 raw CPU profiles/results; 47-comment audit; geometry summaries and three complete exploratory routes. |

The first packet has SHA256 `a8b7f2ce93557d197de6fb7aa0a667d09740bfaceadf659f60311b294c8a395f`; its canonical JSON is 201,547,850 bytes. It derives from the unchanged 1,427-entry milestone parent archive SHA256 `0452838123b831bad8c68f0393f7df156acadf9b0a12c8716948baf28e8c857a`. Exactly one whole 51,199-byte raw web-response entry is omitted; our research note and citations remain. The new selection, source collector and ancestor selection are separately identified. All retained original bytes and core populations match the parent. Explicit ancestry/selection metadata makes the derivative slightly larger despite removing an entry.

The second packet has SHA256 `d173319199dc6f8b80ec627c500fced2f9f3c91d9218a3fd76b371cfd02bb68d`; its canonical JSON is 82,922,792 bytes. It includes the exact approved selection and the full inventory of 8,502 omitted regular files and 30 links. The selection covers every enrolled calibration and CPU-profile worker, not a successful subset. Original declaration-time `PROPOSED` statuses remain beside separately completed execution/assessment records.

The **complete 4,836-row nonlinear geometry assessment is not included**: its 123,007,952-byte file is omitted whole with its SHA, while the prospective specification, summaries, arithmetic readback and original manifest remain. Runtime/install trees, full SVG/public-value CAS bodies and raw third-party response bodies also remain omitted whole with hashes. Class full-value parity therefore relies on retained source-bound assessments and payload identities; this packet cannot reconstruct every omitted payload or provide a self-contained runtime installation. Workspace paths are provenance keys, not promises of public downloads.

The structured companion also retains complete separately hashed originals for later static reviews, the 17:22 discussion delta/peer metadata and independent packaging checks. Those originals are explicitly outside the earlier packet populations. Mutable final reports are excluded from the archives to avoid circular hashes. The later VM-event and route-rescue protocols remain prospective in this snapshot.

Both packets use standard gzip containing UTF8 JSON. Selected entries retain their entire original content; binary originals use explicit base64. No selected file is truncated or filtered to successful rows. Deterministic gzip uses `mtime=0` and no embedded filename. Independent readers checked every entry, source/selection identity and omission inventory; root separately verified all entries and the declared populations.

Verify bytes without executing any packet content:

```python
import base64
import gzip
import hashlib
import json
from pathlib import Path

root = Path('docs/design/system')
stem = 'pr449-exact-subtraction-2026-10-23'
report = json.loads((root / f'{stem}.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
assert sha((root / f'{stem}.md').read_bytes()) == report['markdownSha256']
for binding in report['sealedPublication']['packets']:
    packed = (root / binding['file']).read_bytes()
    assert sha(packed) == binding['sha256']
    raw = gzip.decompress(packed)
    assert len(raw) == binding['canonicalJsonBytes']
    assert sha(raw) == binding['canonicalJsonSha256']
    packet = json.loads(raw)
    assert len(packet['entries']) == binding['originalEntries']
    paths = set()
    total = 0
    for entry in packet['entries']:
        assert entry['path'] not in paths
        paths.add(entry['path'])
        content = (base64.b64decode(entry['content'], validate=True)
                   if entry.get('encoding', 'utf8') == 'base64'
                   else entry['content'].encode('utf-8'))
        assert len(content) == entry['bytes']
        assert sha(content) == entry['sha256']
        total += len(content)
    assert total == binding['originalBytes']
for entry in report['supplementalOriginals']:
    content = entry['content'].encode('utf-8')
    assert len(content) == entry['bytes']
    assert sha(content) == entry['sha256']
```

Archive integrity verifies retained evidence bytes. It does not establish correctness of every inference, renderer superiority, qualified Class cost, complete paint coverage or an exhausted research frontier.
