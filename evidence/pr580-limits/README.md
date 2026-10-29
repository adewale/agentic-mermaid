# PR #580 limits replay

Renderer: `53319dbb976dae1865e19f7faca49464ee8e8557` (Agentic Mermaid).
Observer: `74616adb8fa508ea39fa603f1cfa2c633cf3e0ff` (Trident #54).
Authored cohorts and historical backend check: `2401d09f1c73b1c650445858e5640127368b21c6` (Trident).

These are untimed correctness observations. They consume the public SVG and complete enumerable receipt. They replace no historical records or clocks and claim no performance score. Large SVGs, full replay dumps and archives stay local.

Build the renderer with `bun install --frozen-lockfile && bun run build` at its recorded revision. Run the sparse matrix from any directory:

```sh
node replay-sparse.mjs /absolute/path/to/agentic-mermaid/dist/index.js sparse-results.json
```

The matrix has 24 supported renders and eight expected 5,000-node Agentic refusals; a refusal is not a certified render. It covers 4,096/5,000 entities, one/four relationships, both backends and all four directions. The production graph-size and proof-work limits remain unchanged.

For the 16-case qualification replay, create this working directory layout:

```text
work/agentic-scaling/      renderer checkout at the recorded revision
work/trident-limits/       observer checkout at the recorded revision
work/trident-strict/       historical Trident checkout at the cohort revision
work/limits-requalify.ts
work/limits-requalify-worker.mjs
```

Install the frozen dependencies in each checkout. Copy the two supplied qualification scripts into `work/`, then run from its parent directory:

```sh
QUALIFICATION_NODE="$(command -v node)" bun work/limits-requalify.ts work/verification/requalified work/agentic-scaling/dist/index.js
```

The scripts reject CI collection through Trident's existing policy. They start a fresh Node process per case, serialize all public sidecars and check the requested backend without fallback. The new observer compares exact identities/endpoints with the native model and actual written SVG for the reviewed Class/ER profiles. Arbitrary CSS/fonts, Class members, ER attributes and unsupported marker profiles remain unmeasured.

The two `.mmd` files reproduce the visual route examples with the public renderer. The before output uses `da71287dc3557e79351819acaba97de65a21bff0`; after output uses the renderer revision above. Crops change only viewBox/size attributes for display. The separate `route-replay.json` summarizes the existing 2,800-case route enumeration and independent hard/semantic checks; it is not a timing benchmark.

See `verification.json` and `qualification-replay.json` for results and scope. `ci.json` records exact-head integration checks. Original campaign archive bytes for `cfd58df8ab8c21ce76eb46556296a7439f231bbf` remain unavailable, so archive provenance is unverified. Live-agent evaluations remain blocked by request.
