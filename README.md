# PR #590 evidence

Renderer baseline: `4c72d1c8266a48c31a4ebc5f4f33a0eb0fe648a0`. Renderer candidate: `70842c1c18c071f5b098be836956fb62da33fac6`.

`before-after.png` compares production-rendered SVG and prepared-text lines for the same input/options. Inspect ten zero x-axis labels becoming distinct finite labels, and a soft-hyphen-only line becoming the end of the preceding fragment. The numeric and prepared-text owning tests in the candidate are the independent checks. This finite capture does not establish every font, numeric domain or line-wrap configuration.

## Reproduce

Download this attachment tree, create immutable source worktrees and install their frozen dependencies. `render.ts` calls those worktrees' production APIs, and `capture.ts` uses the candidate's installed Playwright with system Chromium.

```sh
git worktree add --detach /tmp/am-before 4c72d1c8266a48c31a4ebc5f4f33a0eb0fe648a0
git worktree add --detach /tmp/am-after 70842c1c18c071f5b098be836956fb62da33fac6
(cd /tmp/am-before && bun install --frozen-lockfile)
(cd /tmp/am-after && bun install --frozen-lockfile)
mkdir -p /tmp/am-evidence
bun render.ts /tmp/am-before before /tmp/am-evidence
bun render.ts /tmp/am-after after /tmp/am-evidence
bun capture.ts /tmp/am-after /tmp/am-evidence 4c72d1c8266a48c31a4ebc5f4f33a0eb0fe648a0 70842c1c18c071f5b098be836956fb62da33fac6
```

`review-evidence.zip` includes the paired PNG/SVG/JSON, rendering scripts, receipt, named source, math probes and outputs/package identities, the 12-project derivative research, dated profile/contrast observations, local test logs and three adversarial audit reports. Math results are bounded runtime observations or explicitly labeled source inspections, not new mathematical rendering support. Historical package probes identify their own artifacts separately from this candidate. Raw session scripts may retain session paths; the diagram reproduction above is portable. No evidence here establishes a release or deployment.
