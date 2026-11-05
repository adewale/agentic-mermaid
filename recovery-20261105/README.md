# PR449 recovery checkpoint — 5 November 2026

The owner stopped the campaign at 2026-11-05T13:20:32Z. Both the hourly campaign
and deadline-report automations are disabled. This backup supports a future,
explicitly requested continuation; extracting it does not authorize new work.

Source and tests are on `work/pr449-reconstruct-20261103`, reviewed in draft
[PR #602](https://github.com/adewale/agentic-mermaid/pull/602). The source checkpoint
before documentation cleanup is `0a4534ee814d0c380de138b845b0d8e3f5226132`; its
runtime is `c93e0c51f37b1d9edabd81ad6404764eb1dff7e6`. The PR targets the recovery
base `3b56da55e6570908beb5d96c25f4c03c1a828a22`, not current `main`. Integration
and qualification against current `main` remain unfinished.

## What is saved

`archives.json` lists the existing evidence snapshots in restoration order,
their extraction roots, sizes and SHA256 checksums of the uploaded archives.
Historical archives remain intact, including earlier versions of overwritten
files. The last supplement captures remaining current files and the stopped
coordination state. Reconstruction was checked against all 5,122 current week
files (79,512,616 bytes), using byte equality. The compressed backup and local
recovery records occupy about 44 MB; dependencies and build outputs are excluded.

The archives contain actual SVGs, receipts, proof results, raster controls, exact
sources/options, runtime/payload observations, controllers, stopped experiments
and earlier full work logs. `local-recovery-records/` preserves reconstruction
patches, notes, JSON checkpoints and incremental Git bundles. These include
historical active-state snapshots; the current campaign is stopped.

`sparse256/` exposes the latest density comparison without unpacking the backup.
Before is the exact default-options product at `99723bb5dd61762fc0a4e69eace569416ad8f9e0`;
after is `c93e0c51f37b1d9edabd81ad6404764eb1dff7e6`. PNGs are copied from existing
pinned-Inter raster evidence without image edits. `BEFORE-INK-BINDING.json` records
why the historical before raster applies to the complete before SVG/receipt.
The 256 names, one relationship and two cardinality owners remain; the image does
not prove readability or individual glyph attribution for every card/font.

This is the recovered November 3–5 work. The original lost November campaign,
original `campaign-baseline2dadf0dbc2685c8435df541de99f3edce841450d`, Trident and
pinned Mermaid12.2/Pele1.9 tools remain unavailable. No artifact here fills those
gaps or opens Replacement24.

## Restore into a fresh environment

Check out the two branches separately. Source dependencies require Bun 1.4.2
(or a compatible newer Bun); archive extraction requires Python 3.12+.

```sh
git clone --single-branch --branch work/pr449-reconstruct-20261103 \
  https://github.com/adewale/agentic-mermaid.git /tmp/pr449-main-integration-20261029-762
git clone --single-branch --branch review/pr449-evidence-20261105 \
  https://github.com/adewale/agentic-mermaid.git /tmp/pr449-evidence
```

Unpack into an empty scratch directory first. This preserves existing work and
maps absolute historical paths beneath that directory instead of overwriting
`/tmp` or `/workspace` in a running environment.

```sh
cd /tmp/pr449-evidence/recovery-20261105
python3 - <<'PY'
import hashlib, json, pathlib, tarfile
target = pathlib.Path('/tmp/pr449-restore')
target.mkdir(exist_ok=False)
index = json.loads(pathlib.Path('archives.json').read_text())
for entry in index['archives_in_restore_order']:
    archive = pathlib.Path(entry['file'])
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == entry['sha256'], archive
    destination = target / entry['restore_root'].lstrip('/')
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(destination, filter='data')
state_path = target / 'tmp/pr449-correctness-24h-20261030/campaign-state.json'
state = json.loads(state_path.read_text())
assert state['status'] == 'stopped'
state.pop('maintenance', None)
state['writers'] = []
state_path.write_text(json.dumps(state, indent=2) + '\n')
print('Restored evidence to', target, '; campaign remains stopped')
PY
```

The current week evidence is then under
`/tmp/pr449-restore/tmp/pr449-week-comparison-20261101`. Controllers refer to the
original absolute paths. In a fresh environment, copy the restored `tmp/`
contents into `/tmp/` only after checking for existing files; otherwise adapt
the controller paths. Do not copy historical lease states over the final stopped
state. Install source dependencies with `bun install --frozen-lockfile` when
needed; there is no reason to run a giant build merely to restore the evidence.

## Where to continue, if requested

Read the source branch's `docs/design/system/layout-0.6-work-log.md` first. It
contains the current ELK deltas, exact runtime revisions and qualification limits.
The earlier logs are historical evidence, not instructions to resume automation.

The next demonstrated layout tradeoff is forest wire +16.89% versus ELK, with
area 6.43% smaller. Fixed-dock routes are already shortest. Inspect placement and
terminal seating before changing routing; retain the stopped leaf-seat trial's
6.88% area cost. Use authored meaning and final ink for correctness, and ELK to
locate causes. No requirement makes every metric difference zero.
