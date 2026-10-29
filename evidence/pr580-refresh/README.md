# PR #580: current-main verification

Head: `6681910207cdb4f5cea727c6b078833d524468df`.
Base: `cff46b766b5de287ba421234ca42b7093ec18eff`.
Combined candidate: `934e708a2b2ad43d38a1c1a9c9df21020e4db2e0` (parents: base, head).
Trident checkout: `f080278e31e4202ca89d524e4ee9e4cf3cbff038`.
CI: https://github.com/adewale/agentic-mermaid/actions/runs/40942541476

These are untimed correctness observations. No throughput or total-CPU claim is made. The 400,000-operation allowance bounds paint proof, not all rendering work. Large SVGs are consumed locally and represented by byte counts and digests; they are not uploaded.

## Images

`preview.png` compares the public production SVGs from base and the combined candidate, using identical inputs and `{embedFontImport:false}`. The independent loops no longer share a segment. The label **q** moves from the shared shaft to a private channel. These witnesses show route ownership; they do not establish unrestricted diagram readability.

The full SVGs, full PNGs, source inputs and complete enumerable receipts are retained here. Resvg rasterization applies the repository's marker-orientation compatibility helper, an opaque white background and a 2× scale in both phases. System fonts are used; text positions remain those in the emitted SVG. Both phases use the same crop coordinates and scale. The loop panels cover SVG coordinates `(0,0)`–`(300,130)` with white padding where the canvas is smaller. The label panels cover `(235,30)`–`(615,160)`, displayed at 1.5×. No diagram artwork is redrawn.

## Reproduce

Use Node 24.19.0 and Bun 1.4.2. Check out base and candidate into separate repositories/worktrees, run `bun install --frozen-lockfile` and `bun run build` in each, and keep this evidence directory separate from both. From this directory, replacing the absolute repository paths:

```sh
node render-evidence.mjs /path/to/base before /path/to/this-directory
node render-evidence.mjs /path/to/candidate after /path/to/this-directory
python compose-evidence.py
node replay-captured.mjs /path/to/candidate/dist/index.js captured-combined.json
node replay-sparse.mjs /path/to/candidate/dist/index.js sparse-combined.json
```

The compositor needs Pillow and DejaVu Sans. The render driver uses the selected repository's installed Resvg and production API. The sparse driver constructs 32 purposeful boundary cases: 4,096/5,000 entities, one/four relationships, ELK/Agentic and four directions. It checks every authored ID and directed endpoint pair, consumes the entire receipt and retains its enumerated fields. The expected Agentic 5,000-node refusal is distinct from an accidental render failure. The captured driver checks all 128 IDs and all 127 directed chain edges for each of three requested-backend cases.

The original captured inputs are at https://github.com/adewale/agentic-mermaid/tree/b06a2902a75ccf7ebf1e300fa3f05b2f9c3de9d0 (the files are at the commit root). The copied small input/options files retain those bytes.

## Regressions and limits

Run the existing route regression table with:

```sh
bun test src/__tests__/route-contracts.test.ts --test-name-pattern 'a private channel retains' --timeout 30000
```

Its 20 cases cover four rotations, source/target/both marker positions, solid/thick shafts and redundant collinear waypoints. They require retained anchors, sufficient marked leads, a private route and unchanged foreign arrowheads. Replacing the source allowance with the target allowance causes six failures; replacing the full collinear lead with the first waypoint causes two. The attached mutation logs record those deliberate removals before restoration. CI independently checks changed tests against base production.

Private channels preserve an existing short terminal when a neighboring card blocks extension of its fixed port. They do not solve that pre-existing port-allocation limit. Groups, custom host measurement, curves, rounded routes, stroke-width overrides and base line widths above two are excluded from this bounded repair. Ordinary crossings can increase while ambiguous labels are separated.

The 2,800-case audit, the Node 22/24/Chromium sparse observations and Trident #54's 16-case qualification in the earlier PR description remain historical observations at their recorded revisions. The fresh replay results here do not rerun that full historical campaign. Original campaign archive bytes remain unavailable. Live-agent runs remain blocked by request. Unsupported CSS/fonts and Class/ER profiles remain outside those qualification claims.
