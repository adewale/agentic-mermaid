# Resumed PR602 checkpoint — 5 November 2026

The owner resumed the campaign, including regular commits and pushes. Its original
deadline is **2026-11-08T23:59:59Z**. Work runs in bounded sessions with a fresh
coordination lease; there is no claim of continuous execution between runs.

Source checkpoint: `49945278ffb96f925fa903a0819ee91952b1ceb3` on
`work/pr449-reconstruct-20261103`, draft
[PR #602](https://github.com/adewale/agentic-mermaid/pull/602), now targeting `main`.
The history-preserving merge retains main
`f9ec8c115de14020d3c182d5d7f2e7e70bfcdefb` and the recovered foundation. Main's
release identity and default are preserved. The original recovery checkpoint
remains in history and the earlier evidence checkpoint.

## New work saved here

- Main integration and conflict-resolution drafts, multiline-style RED/GREEN,
  private-point mutation/substitution RED/GREEN, broad owner logs and permitted
  isolated requalification. The introduced point callout is repaired in `99ed1d238`.
- The report-first Node24 profile at `99ed1d238`: six warmups and 18 fully consumed
  calls, raw profiles/source maps, actual SVGs/entire receipts, cache events,
  separate wall/CPU/RSS/heap counters, and offline SVG gzip/Brotli measurements.
  No performance rewrite or speedup forecast is established by that report.
- CI99ed logs and downloaded payload diagnostic artifact. That CI run used the
  synthetic recovery-base checkout, not a new current-main comparison. Its
  absolute budget failures are real; relative base attribution remains 3b56.
- The reproduced unused-discretionary-hint caption refusal and two-line producer
  sealing repair (`93f4aaec7`), its 90 text/property passes, final six Unicode passes
  with the reduced counterexample, core typing and lint. No admission/cap is relaxed.
- SDK generation and 13 passing SDK/release owners. `49945278f` refreshes stale
  line/fragment ink declarations that caused build-generated dirty provenance.

`checkpoint.json` records the archive's checksum, file count and byte comparison.
The archive contains only completed evidence directories and a coordination-state
snapshot. Dependencies and builds are excluded. The source commits are stored by
GitHub on the PR branch; derived evidence stays outside its source diff.

## Recover safely

Clone the source and evidence branches as described by the earlier immutable
[restore guide](https://github.com/adewale/agentic-mermaid/blob/24f5f1ab972937d687691d5282b6cec04830c5b8/recovery-20261105/README.md).
That earlier guide describes the then-stopped checkpoint. Restore its original
archives first into empty scratch space, then overlay this archive there:

```sh
cd /tmp/pr449-evidence/resumed-20261105
python3 - <<'PY'
import hashlib, json, pathlib, tarfile
record = json.loads(pathlib.Path('checkpoint.json').read_text())
archive = pathlib.Path(record['archive'])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == record['sha256']
target = pathlib.Path('/tmp/pr449-restore')
target.mkdir(exist_ok=True)
with tarfile.open(archive) as bundle:
    bundle.extractall(target, filter='data')
print('Resumed evidence restored beneath', target)
PY
```

Historical absolute `/tmp/` paths are beneath the scratch target. Copy them into
place only after checking for existing work. Do not reuse the archived lease,
writer identity or recorded head. Check live writers/processes, read current owner
messages, refresh GitHub branch state, and acquire a new lease. Verify the hosted
automation settings separately; extracting JSON does not configure scheduling.
Stop at the deadline or an earlier owner stop. Do not open Replacement24.

Use Bun1.4.4 for current-main owning checks and Node24.19.0 for this profile's source
loader. The profile collector imports current TypeScript directly; no giant build
is needed to reproduce it. Read the committed work log and performance review
before choosing another probe; do not replay old measurements as progress.

## Remaining work

CI is not qualified. Sparse32's 400k cap, reviewed golden changes, code/website
payload ceilings, and confirmation of the dirty-provenance repair remain open.
The latest caption/SDK repairs require fresh final-head CI. No baseline is updated
or ceiling raised merely to make a check green.

Forest wire remains +16.89% versus ELK with area −6.43%; both fresh SVGs are
byte-identical to their retained products. A distinct untested candidate is a
route-only fanout for terminal peers with aligned main centers, avoiding the old
leaf-seat trial's body equalization and +6.88% area cost. Its predicted −5.74% wire
gain is not a result. Requirement directional loss and shared ER256 refusal remain.
The original lost campaign, original fixed baseline and missing pinned peer tools
are still unavailable. Authored meaning and final ink supply correctness; ELK
supplies counterexamples and alternatives, without a zero-metric-difference gate.
