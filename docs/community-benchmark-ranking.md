# Mermaid community benchmark ranking

Updated from community evidence **2026-10-24T20:22:33.890Z → 2026-10-24T22:03:34.154Z**. Separate measurement and composition windows are identified below.

Original full-run ledger: **failed**, 2026-10-24T14:59:47.204Z → 2026-10-24T18:01:45.267Z; target `2cff725d219c75b75593b1d3e9bacd74cba7a08e`. Explicit scoped replays below do not rewrite that aggregate status.

This is a maintained history requested by the project owner. The current uniform
Pele 1.9 set is in [the 25 October results](#docs-original-tests-required-families-and-startup-25-october-2026).
The command below records the historical 24 October selection. It contains mixed
peer releases and is not eligible for current-set composition; the version guard
rejects it rather than relabelling historical measurements.

```sh
bun run bench:scorecard -- --run /workspace/mermaid-unified-2026-10-24/all --prs /workspace/mermaid-unified-2026-10-24/prs-latest --community-run /workspace/mermaid-unified-2026-10-24/community-corrected/community --allow-community-target-change --invocation-correction /workspace/mermaid-unified-2026-10-24/invocation-corrected/invocation-corrected.json --reference-correction /workspace/mermaid-unified-2026-10-24/reference-correction/pinned-reference-score/reference-score-result.json --current-run /workspace/mermaid-unified-2026-10-24/current-main --additional-run /workspace/mermaid-unified-2026-10-24/late-matched-current --cli-native-proof /workspace/mermaid-unified-2026-10-24/prep/main-native-reproduction.json --historical-prs /workspace/mermaid-unified-2026-10-24/prs-current --current-invocation-run /workspace/mermaid-unified-2026-10-24/latest-main-full --current-invocation-assets /workspace/mermaid-unified-2026-10-24/prep/latest-main-invocation-assets.json --current-dave-run /workspace/mermaid-unified-2026-10-24/latest-main-dave --family-correction /workspace/mermaid-unified-2026-10-24/family-empty-correction/manifest.json --cli-resource-run /workspace/mermaid-unified-2026-10-24/cli-resources --suite-run /workspace/mermaid-unified-2026-10-24/corrections/browser-provisioned --suite-run /workspace/mermaid-unified-2026-10-24/corrections/family-owner --suite-run /workspace/mermaid-unified-2026-10-24/corrections/ownership --suite-run /workspace/mermaid-unified-2026-10-24/late-maintained
```

The JSON community catalog enrolls **84 nodes**, with **84 configured candidates**. Configuration is not a working-API claim. Actual acquisition, unsupported operations, host failures and source-evidence aliases remain visible; none become passing renderer results by enrollment alone.

## Comparison policy

- Every API/CLI/browser boundary has its own rank; there is no invented weighted overall winner.
- SVG/PNG/parser core: six identical inputs across five families. Terminal core: three identical inputs across two families.
- Every required input must qualify in every round. Rejected, missing-label, unsupported and blocked results are retained; none become zero-cost wins.
- Harness validation/assertions and transport are outside plain API clocks; engine-owned layout, serialization and encoding remain included when part of the public operation. Fully consumed receipts and transport/CLI costs are distinct invocation benchmarks.
- Feature-corpus attempts, family-balanced coverage, and pinned-Mermaid same-case scores accompany speed; existential text presence is not complete semantic/visual fidelity.

## Stack ranks

**Community replay:** Mixed-window correctness-qualification evidence. Engine bytes, sources, labels, protocols, pins and target remain frozen. SVG/IR timings are fresh under repaired admission; unaffected observations are exact original JSON. No product speed-improvement attribution. Evidence: /tmp/mermaid-community-qualification-composed/community; completed 2026-10-24T22:03:34.154Z. Original ledger remains unchanged; this is not a product improvement or a new full run.

**Invocation correction:** Public textTransform-aware style display retention; mixed-role correspondence unmeasured Evidence: /workspace/mermaid-unified-2026-10-24/invocation-corrected/invocation-corrected.json; completed 2026-10-24T18:53:01.361Z. Original ledger remains unchanged; this is not a product improvement or a new full run.

**Reference baseline correction:** Reviewed positive-eligibility protocol repair; diagnostic inputs remain retained separately. Evidence: /workspace/mermaid-unified-2026-10-24/reference-correction/pinned-reference-score/reference-score-result.json; completed 2026-10-24T18:55:41.143Z. Original ledger remains unchanged; this is not a product improvement or a new full run.

**Community-only target advance:** `2cff725d219c75b75593b1d3e9bacd74cba7a08e` → `dce89b73d00bf9d4b8f847b1ab261d9c58e06083`, measured 2026-10-24T20:22:33.890Z → 2026-10-24T22:03:34.154Z. New actual target tarball SHA256: `cc42363433b610c3d475029be305226756248addf03b5bd0092d3cfe70e84fa6`. Every original invocation, pinned-reference correction and owning suite keeps its separately recorded older target. The expanded population/protocol and changed product prevent attributing the difference to a single optimization.


**Explicit community qualification composition:** original non-SVG/non-IR measurements 2026-10-24T20:22:33.890Z → 2026-10-24T21:16:26.242Z; fresh SVG/React Flow qualification measurements 2026-10-24T21:40:09.376Z → 2026-10-24T22:01:07.602Z. Composed 2026-10-24T22:03:34.154Z. Engine bytes, target, pins and literal sources remain fixed. This repairs benchmark qualification and does not measure product speed improvement. Original raw ledgers remain unchanged.


**Native CLI source binding:** a clean-source rebuild of dce89b73d00bf9d4b8f847b1ab261d9c58e06083 reproduced the exact previously measured executable SHA256 35b2acd070793c67e01d6d7445bb90f36951e542acb75123d1c3cab7dec98aaf. The post-latency proof adds source provenance; no timing row changes. Proof: /workspace/mermaid-unified-2026-10-24/prep/main-native-reproduction.json.


**Explicit fixed-work CLI resource observation:** Explicit later one-pass fixed-work GNU-time resource-only observation. The rounds3 field identifies earlier latency, not repeated resource passes. Original missing-observer diagnostics remain immutable; every existing CLI latency observation/rank/window is preserved. RSS/CPU are scoped diagnostics, not a latency rerun or allocation rank. 2026-10-25T04:47:39.701Z → 2026-10-25T04:47:54.965Z; 22 qualified resource cohorts. Actual observer /workspace/tooling/time-unified/usr/bin/time with recorded byte identity/version. Old missing-observer rows remain at their original paths.

### node:public-api / parse

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | inkeep/visimer | 1.1.3 | 0.40 | 0.40–0.43 |
| 2 | Dicklesworthstone/frankenmermaid | 0.4.0 | 3.04 | 2.94–3.05 |
| 3 | crafter-station/mermaid | 0.0.3 | 5.80 | 5.78–5.86 |
| 4 | neongreen/mermaid-ast | 0.8.2 | 9.77 | 9.71–10.85 |
| 5 | adewale/agentic-mermaid | 0.4.2 | 10.51 | 10.51–12.06 |

### bun:published-renderer-component / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | ramtinJ95/pi-mermaid-tui | 0.2.4 | 1.04 | 0.98–1.16 |
| 2 | Yassimba/loom | 0.10.0 | 4.54 | 3.95–4.71 |

### node:public-api / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | npm:tui-mermaid | 0.1.0 | 1.17 | 1.14–1.25 |
| 2 | xl0/lovely-mermaid | 0.3.3 | 3.25 | 2.99–3.77 |
| 3 | dfadler/zombie-mermaid | 5.9.1 | 14.94 | 14.84–15.15 |
| 4 | emtyty/merslim | 0.2.3 | 19.14 | 15.19–20.06 |
| 5 | mopi1402/termaid-ts | 0.8.3 | 44.90 | 43.50–48.31 |
| 6 | adewale/agentic-mermaid | 0.4.2 | 47.71 | 46.07–49.77 |
| 7 | rohitg00/beautiful-mermaid | 0.1.3 | 87.40 | 84.83–88.18 |
| 8 | 01colyncelestine-stack/beautiful-mermaid | 0.1.3 | 87.74 | 84.43–92.38 |
| 9 | fdotu/beautiful-mermaid (shared evidence: 01colyncelestine-stack/beautiful-mermaid) | 0.1.3 | 87.74 | 84.43–92.38 |
| 10 | gmh5225/beautiful-mermaid (shared evidence: 01colyncelestine-stack/beautiful-mermaid) | 0.1.3 | 87.74 | 84.43–92.38 |
| 11 | theletterf/beautiful-mermaid | 0.1.5 | 93.33 | 90.61–96.96 |
| 12 | kais-radwan/ascii-mermaid | 0.1.0 | 96.34 | 87.02–108.93 |
| 13 | vercel-labs/beautiful-mermaid | 0.1.5 | 96.93 | 85.52–99.34 |
| 14 | thepanax/beautiful-mermaid | 1.1.3 | 157.20 | 156.30–158.98 |
| 15 | 2233admin/beautiful-mermaid | 1.1.3 | 159.50 | 154.00–171.84 |
| 16 | HealthSamurai/beautiful-mermaid (shared evidence: 2233admin/beautiful-mermaid) | 1.1.3 | 159.50 | 154.00–171.84 |
| 17 | Stars1233/beautiful-mermaid (shared evidence: 2233admin/beautiful-mermaid) | 1.1.3 | 159.50 | 154.00–171.84 |
| 18 | ktrysmt/beautiful-mermaid | 1.5.2 | 173.66 | 158.02–176.40 |
| 19 | lukilabs/beautiful-mermaid | 1.1.3 | 176.05 | 152.86–178.70 |
| 20 | zhenhuaa/mdv | 0.1.2 | 1152.13 | 1144.12–1152.26 |
| N/A | tariqshams/mermaidtui | 0.0.6 | Unqualified | — |

### node:public-api / svg

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | wevm/ondine | 0.0.3 | 1.72 | 1.67–1.84 |
| 2 | crabtalk/bezel | 0.2.20 | 2.59 | 2.55–2.75 |
| 3 | obsidianmd/pele | 1.9.0 | 3.52 | 3.50–3.54 |
| 4 | Dicklesworthstone/frankenmermaid | 0.4.0 | 6.70 | 6.55–6.77 |
| 5 | orestesgaolin/mermaid | 0.3.2 | 28.20 | 26.44–30.78 |
| 6 | Latias94/merman | 0.9.2 | 44.74 | 43.21–44.80 |
| 7 | theletterf/beautiful-mermaid | 0.1.5 | 58.57 | 58.14–65.58 |
| 8 | vercel-labs/beautiful-mermaid | 0.1.5 | 59.03 | 59.00–63.12 |
| 9 | rohitg00/beautiful-mermaid | 0.1.3 | 60.15 | 58.43–62.54 |
| 10 | 01colyncelestine-stack/beautiful-mermaid | 0.1.3 | 64.05 | 60.82–69.00 |
| 11 | fdotu/beautiful-mermaid (shared evidence: 01colyncelestine-stack/beautiful-mermaid) | 0.1.3 | 64.05 | 60.82–69.00 |
| 12 | gmh5225/beautiful-mermaid (shared evidence: 01colyncelestine-stack/beautiful-mermaid) | 0.1.3 | 64.05 | 60.82–69.00 |
| 13 | toeverything/mermaid-rs-renderer | 0.1.2 | 70.58 | 69.03–71.38 |
| 14 | adewale/agentic-mermaid | 0.4.2 | 101.75 | 91.76–102.32 |
| 15 | dfadler/zombie-mermaid | 5.9.1 | 125.37 | 119.76–126.96 |
| 16 | ktrysmt/beautiful-mermaid | 1.5.2 | 126.87 | 110.39–128.17 |
| 17 | zhenhuaa/mdv | 0.1.2 | 138.01 | 135.92–152.62 |
| 18 | lukilabs/beautiful-mermaid | 1.1.3 | 144.21 | 136.77–149.50 |
| 19 | 2233admin/beautiful-mermaid | 1.1.3 | 144.77 | 144.68–146.27 |
| 20 | HealthSamurai/beautiful-mermaid (shared evidence: 2233admin/beautiful-mermaid) | 1.1.3 | 144.77 | 144.68–146.27 |
| 21 | Stars1233/beautiful-mermaid (shared evidence: 2233admin/beautiful-mermaid) | 1.1.3 | 144.77 | 144.68–146.27 |
| 22 | thepanax/beautiful-mermaid | 1.1.3 | 146.25 | 141.40–146.34 |
| 23 | woxQAQ/mermaid-rs-render-js | 0.1.4 | 535.54 | 524.43–540.62 |
| 24 | akashacms/mermaid-wasm-renderer | 0.3.1 | 977.12 | 962.40–1030.92 |
| N/A | crafter-station/mermaid | 0.0.3 | Unqualified | — |
| N/A | emtyty/merslim | 0.2.3 | Unqualified | — |
| N/A | evangwt/xmermaid | 0.4.2 | Unqualified | — |
| N/A | KlangHaus/vitepress-plugin-diagram | 0.3.2 | Unqualified | — |
| N/A | sandyyst/dsh-plugin-mermaid-gb-svg | 0.1.4 | Unqualified | — |

### node:public-api / source

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | chenyanchen/mermaid-formatter | 0.3.0 | 2.31 | 2.27–2.31 |

### browser:public-api / svg

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | crabtalk/bezel | 0.2.20 | 2.78 | 2.62–2.92 |
| 2 | wevm/ondine | 0.0.3 | 3.40 | 3.39–3.58 |
| 3 | obsidianmd/pele | 1.9.0 | 4.23 | 4.20–4.72 |
| 4 | Dicklesworthstone/frankenmermaid | 0.4.0 | 6.18 | 5.85–6.67 |
| 5 | orestesgaolin/mermaid | 0.3.2 | 19.99 | 19.85–22.91 |
| 6 | gmh5225/beautiful-mermaid | 0.1.3 | 53.33 | 50.65–58.94 |
| 7 | rohitg00/beautiful-mermaid | 0.1.3 | 53.95 | 53.45–60.23 |
| 8 | fdotu/beautiful-mermaid | 0.1.3 | 54.54 | 52.71–55.42 |
| 9 | 01colyncelestine-stack/beautiful-mermaid | 0.1.3 | 55.18 | 52.13–58.25 |
| 10 | vercel-labs/beautiful-mermaid | 0.1.5 | 57.20 | 54.14–60.62 |
| 11 | theletterf/beautiful-mermaid | 0.1.5 | 57.33 | 45.82–61.23 |
| 12 | toeverything/mermaid-rs-renderer | 0.1.2 | 73.34 | 70.93–79.62 |
| 13 | adewale/agentic-mermaid | 0.4.2 | 99.45 | 91.05–103.09 |
| 14 | dfadler/zombie-mermaid | 5.9.1 | 117.34 | 109.41–133.72 |
| 15 | ktrysmt/beautiful-mermaid | 1.5.2 | 123.65 | 118.04–124.34 |
| 16 | Latias94/merman | 0.9.2 | 133.60 | 125.09–143.25 |
| 17 | Stars1233/beautiful-mermaid | 1.1.3 | 140.55 | 138.34–150.55 |
| 18 | zhenhuaa/mdv | 0.1.2 | 143.20 | 128.19–146.17 |
| 19 | HealthSamurai/beautiful-mermaid | 1.1.3 | 151.37 | 141.16–165.52 |
| 20 | 2233admin/beautiful-mermaid | 1.1.3 | 152.07 | 149.34–156.87 |
| 21 | lukilabs/beautiful-mermaid | 1.1.3 | 160.47 | 136.14–167.17 |
| 22 | thepanax/beautiful-mermaid | 1.1.3 | 165.72 | 147.99–167.41 |
| 23 | ysknsid25/beautiful-mermaid | 1.0.2 | 176.97 | 161.97–183.61 |
| 24 | mbostock/mermaid | 9.0.0 | 419.40 | 414.98–475.65 |
| 25 | xeolabs/mermaid | 10.0.2 | 613.65 | 605.40–631.65 |
| 26 | NicolasNewman/mermaid | 11.4.1 | 865.60 | 854.95–882.50 |
| 27 | jacob-lcs/mermaid | 11.9.0 | 1185.50 | 1157.55–1250.85 |
| 28 | ioggstream/d3fend-mermaid | 11.11.637 | 1250.70 | 1219.90–1294.45 |
| 29 | mermaid-js/mermaid | 12.2.0 | 2408.00 | 2197.70–2419.60 |
| N/A | blackst0ne/mermaid | 7.1.0-fixed | Unqualified | — |
| N/A | enrimr/mermaid | 1.0.0 | Unqualified | — |
| N/A | jgraph/mermaid | 11.14.0 | Unqualified | — |
| N/A | lishid/mermaid | 8.10.2 | Unqualified | — |
| N/A | lyngai/mermaid | 8.4.8 | Unqualified | — |
| N/A | Mermaid-Chart/mermaid-develop | 10.6.1 | Unqualified | — |
| N/A | songshaodong/mermaid | 0.5.8 | Unqualified | — |
| N/A | xen3r0/mermaid | 8.0.0-rc.9 | Unqualified | — |
| N/A | zakaria-forks/mermaid | 11.0.0-alpha.7 | Unqualified | — |
| N/A | crafter-station/mermaid | 0.0.3 | Unqualified | — |
| N/A | evangwt/xmermaid | 0.4.2 | Unqualified | — |
| N/A | KlangHaus/vitepress-plugin-diagram | 0.3.2 | Unqualified | — |
| N/A | sandyyst/dsh-plugin-mermaid-gb-svg | 0.1.4 | Unqualified | — |

### bun:public-api / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | kitlangton/merman | 0.2.1 | 4.95 | 4.61–5.00 |
| 2 | ysknsid25/beautiful-mermaid | 1.0.2 | 78.70 | 75.52–95.56 |

### python:public-api / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | fasouto/termaid | 0.9.1 | 34.65 | 33.10–34.97 |

### bun:opentui-headless-integration / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | anomalyco/opencode | 2.0.26 | 142.35 | 138.04–145.93 |
| 2 | 4nkitd/opencode-merman | 0.1.1 | 283.84 | 282.29–294.10 |

### browser:react-component / svg

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | emtyty/merslim | 0.2.3 | 157.80 | 155.20–167.20 |

### bun:public-api / svg

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | ysknsid25/beautiful-mermaid | 1.0.2 | 164.37 | 162.61–193.26 |

### browser:react-component / png

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | emtyty/merslim | 0.2.3 | 741.45 | 728.50–741.80 |

### node:public-parse-validation / parse

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | mermaid-js/mermaid | 12.2.0 | 827.85 | 790.17–915.43 |

### node:public-api / png

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| N/A | adewale/agentic-mermaid | 0.4.2 | Unqualified | — |
| N/A | emtyty/merslim | 0.2.3 | Unqualified | — |
| N/A | Latias94/merman | 0.9.2 | Unqualified | — |

### node:public-api / diagnostics

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| N/A | aj-archipelago/merval | 1.0.7 | Unqualified | — |
| N/A | probelabs/maid | 0.0.29 | Unqualified | — |

### node:public-api / react-flow

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| N/A | taoche/mermaid-reactflow-render | 0.5.1 | Unqualified | — |

### cli:end-to-end / svg

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | 1jehuang/mermaid-rs-renderer | v0.3.1 | 609.26 | 607.57–628.70 |
| 2 | adewale/agentic-mermaid#node-cli | 0.4.2 | 3461.98 | 3426.80–3521.31 |
| 3 | adewale/agentic-mermaid#native-cli | 0.4.2 | 3640.48 | 3506.81–3853.98 |

### cli:end-to-end / terminal

| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |
|---:|---|---|---:|---:|
| 1 | xai-org/grok-build | git-2bdd1d6a6369 | 4.54 | 4.24–4.61 |
| 2 | spacedock-dev/mermaidtext | git-a6b0c7657b94 | 5.22 | 4.39–5.33 |
| 3 | CaptainCrouton89/mermaid-ascii | git-edffbe69fcbf | 168.84 | 162.09–188.58 |
| 4 | Chronostasys/mermaid-ascii | git-a903e2a57055 | 170.72 | 142.32–177.53 |
| 5 | AlexanderGrooff/mermaid-ascii | 1.6.1 | 173.94 | 166.38–175.10 |
| 6 | pgavlin/mermaid-ascii | git-ab8074a98bef | 176.48 | 170.98–188.21 |
| 7 | ktrysmt/mermaid-ascii | git-7fd22bc0a0ef | 206.91 | 203.39–233.60 |
| 8 | app-creative/mermaid-ascii | git-2955c2e36e05 | 208.22 | 204.39–236.19 |
| 9 | ColtWindy/mermaid-ascii | git-b5d02c35decf | 212.65 | 203.46–219.13 |
| 10 | catdevman/mermaid-ascii | git-2955c2e36e05 | 213.35 | 196.78–238.73 |
| 11 | sgryjp/mermaid-ascii | git-2955c2e36e05 | 215.63 | 209.84–240.51 |
| 12 | jeis4wpi/mermaid-ascii | git-2955c2e36e05 | 217.69 | 193.83–236.71 |
| 13 | dydoc/mermaid-ascii | git-2955c2e36e05 | 220.01 | 208.12–226.58 |
| 14 | leonj1/mermaid-ascii | git-2955c2e36e05 | 226.00 | 213.97–230.32 |
| 15 | Aurelian-Shuttleworth/mermaid-ascii | git-2955c2e36e05 | 233.65 | 211.06–245.13 |
| 16 | mopi1402/termaid | 0.8.0 | 692.12 | 674.09–696.59 |
| 17 | adewale/agentic-mermaid#node-cli | 0.4.2 | 1276.81 | 1225.73–1333.43 |
| 18 | adewale/agentic-mermaid#native-cli | 0.4.2 | 1290.03 | 1277.56–1387.84 |
| 19 | Orbiter/beautiful-mermaid-py | git-d5daa97c8e3f | 1511.30 | 1487.57–1566.84 |
| N/A | drunkhacker/mermaid-ascii | git-3b13f4557d40 | Unqualified | — |
| N/A | kingsword09/mermansi | v0.1.6 | Unqualified | — |
| N/A | Mootikins/figurehead-rs | v0.4.3 | Unqualified | — |

## Conditional family stack ranks

These reuse only the existing fixed core: flowchart has two inputs, other SVG/parser families one; terminal flowchart two and sequence one. Every required input must qualify in every round. This supports narrow tools without implying complete family functionality.

| Family | Boundary / output | Rank | Implementation | Qualified family core, ms | Evidence |
|---|---|---:|---|---:|---|
| sequence | node:public-api / parse | 1 | inkeep/visimer | 0.01 | independent attempt |
| sequence | node:public-api / parse | 2 | crafter-station/mermaid | 0.03 | independent attempt |
| sequence | node:public-api / parse | 3 | Dicklesworthstone/frankenmermaid | 0.15 | independent attempt |
| sequence | node:public-api / parse | 4 | adewale/agentic-mermaid | 0.15 | independent attempt |
| sequence | node:public-api / parse | 5 | neongreen/mermaid-ast | 0.24 | independent attempt |
| sequence | browser:public-api / svg | 1 | theletterf/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 2 | fdotu/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 3 | 01colyncelestine-stack/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 4 | rohitg00/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 5 | vercel-labs/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 6 | gmh5225/beautiful-mermaid | 0.03 | independent attempt |
| sequence | browser:public-api / svg | 7 | thepanax/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 8 | ysknsid25/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 9 | zhenhuaa/mdv | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 10 | lukilabs/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 11 | 2233admin/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 12 | HealthSamurai/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 13 | ktrysmt/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 14 | Stars1233/beautiful-mermaid | 0.07 | independent attempt |
| sequence | browser:public-api / svg | 15 | crabtalk/bezel | 0.08 | independent attempt |
| sequence | browser:public-api / svg | 16 | obsidianmd/pele | 0.08 | independent attempt |
| sequence | browser:public-api / svg | 17 | wevm/ondine | 0.09 | independent attempt |
| sequence | browser:public-api / svg | 18 | KlangHaus/vitepress-plugin-diagram | 0.16 | independent attempt |
| sequence | browser:public-api / svg | 19 | Dicklesworthstone/frankenmermaid | 0.19 | independent attempt |
| sequence | browser:public-api / svg | 20 | dfadler/zombie-mermaid | 0.21 | independent attempt |
| sequence | browser:public-api / svg | 21 | orestesgaolin/mermaid | 0.22 | independent attempt |
| sequence | browser:public-api / svg | 22 | toeverything/mermaid-rs-renderer | 0.26 | independent attempt |
| sequence | browser:public-api / svg | 23 | evangwt/xmermaid | 0.78 | independent attempt |
| sequence | browser:public-api / svg | 24 | songshaodong/mermaid | 3.44 | independent attempt |
| sequence | browser:public-api / svg | 25 | lishid/mermaid | 4.65 | independent attempt |
| sequence | browser:public-api / svg | 26 | Latias94/merman | 5.13 | independent attempt |
| sequence | browser:public-api / svg | 27 | xen3r0/mermaid | 5.50 | independent attempt |
| sequence | browser:public-api / svg | 28 | blackst0ne/mermaid | 5.77 | independent attempt |
| sequence | browser:public-api / svg | 29 | adewale/agentic-mermaid | 5.98 | independent attempt |
| sequence | browser:public-api / svg | 30 | enrimr/mermaid | 6.02 | independent attempt |
| sequence | browser:public-api / svg | 31 | lyngai/mermaid | 6.45 | independent attempt |
| sequence | browser:public-api / svg | 32 | mbostock/mermaid | 6.63 | independent attempt |
| sequence | browser:public-api / svg | 33 | zakaria-forks/mermaid | 10.90 | independent attempt |
| sequence | browser:public-api / svg | 34 | jacob-lcs/mermaid | 12.20 | independent attempt |
| sequence | browser:public-api / svg | 35 | xeolabs/mermaid | 12.45 | independent attempt |
| sequence | browser:public-api / svg | 36 | NicolasNewman/mermaid | 12.60 | independent attempt |
| sequence | browser:public-api / svg | 37 | ioggstream/d3fend-mermaid | 12.65 | independent attempt |
| sequence | browser:public-api / svg | 38 | Mermaid-Chart/mermaid-develop | 12.70 | independent attempt |
| sequence | browser:public-api / svg | 39 | mermaid-js/mermaid | 32.60 | independent attempt |
| sequence | browser:public-api / svg | N/A | jgraph/mermaid | Unqualified | independent attempt |
| sequence | browser:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| sequence | browser:public-api / svg | N/A | sandyyst/dsh-plugin-mermaid-gb-svg | Unqualified | independent attempt |
| sequence | node:public-api / svg | 1 | vercel-labs/beautiful-mermaid | 0.03 | independent attempt |
| sequence | node:public-api / svg | 2 | theletterf/beautiful-mermaid | 0.03 | independent attempt |
| sequence | node:public-api / svg | 3 | rohitg00/beautiful-mermaid | 0.03 | independent attempt |
| sequence | node:public-api / svg | 4 | 01colyncelestine-stack/beautiful-mermaid | 0.03 | independent attempt |
| sequence | node:public-api / svg | 5 | fdotu/beautiful-mermaid | 0.03 | shared: 01colyncelestine-stack/beautiful-mermaid |
| sequence | node:public-api / svg | 6 | gmh5225/beautiful-mermaid | 0.03 | shared: 01colyncelestine-stack/beautiful-mermaid |
| sequence | node:public-api / svg | 7 | wevm/ondine | 0.05 | independent attempt |
| sequence | node:public-api / svg | 8 | obsidianmd/pele | 0.06 | independent attempt |
| sequence | node:public-api / svg | 9 | crabtalk/bezel | 0.07 | independent attempt |
| sequence | node:public-api / svg | 10 | ktrysmt/beautiful-mermaid | 0.07 | independent attempt |
| sequence | node:public-api / svg | 11 | zhenhuaa/mdv | 0.07 | independent attempt |
| sequence | node:public-api / svg | 12 | lukilabs/beautiful-mermaid | 0.07 | independent attempt |
| sequence | node:public-api / svg | 13 | thepanax/beautiful-mermaid | 0.07 | independent attempt |
| sequence | node:public-api / svg | 14 | 2233admin/beautiful-mermaid | 0.07 | independent attempt |
| sequence | node:public-api / svg | 15 | HealthSamurai/beautiful-mermaid | 0.07 | shared: 2233admin/beautiful-mermaid |
| sequence | node:public-api / svg | 16 | Stars1233/beautiful-mermaid | 0.07 | shared: 2233admin/beautiful-mermaid |
| sequence | node:public-api / svg | 17 | KlangHaus/vitepress-plugin-diagram | 0.17 | independent attempt |
| sequence | node:public-api / svg | 18 | toeverything/mermaid-rs-renderer | 0.18 | independent attempt |
| sequence | node:public-api / svg | 19 | Dicklesworthstone/frankenmermaid | 0.20 | independent attempt |
| sequence | node:public-api / svg | 20 | dfadler/zombie-mermaid | 0.23 | independent attempt |
| sequence | node:public-api / svg | 21 | orestesgaolin/mermaid | 0.30 | independent attempt |
| sequence | node:public-api / svg | 22 | Latias94/merman | 1.45 | independent attempt |
| sequence | node:public-api / svg | 23 | woxQAQ/mermaid-rs-render-js | 2.51 | independent attempt |
| sequence | node:public-api / svg | 24 | akashacms/mermaid-wasm-renderer | 4.42 | independent attempt |
| sequence | node:public-api / svg | 25 | adewale/agentic-mermaid | 5.47 | independent attempt |
| sequence | node:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| sequence | node:public-api / svg | N/A | emtyty/merslim | Unqualified | independent attempt |
| sequence | node:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| sequence | node:public-api / svg | N/A | sandyyst/dsh-plugin-mermaid-gb-svg | Unqualified | independent attempt |
| er | node:public-api / parse | 1 | inkeep/visimer | 0.06 | independent attempt |
| er | node:public-api / parse | 2 | Dicklesworthstone/frankenmermaid | 0.41 | independent attempt |
| er | node:public-api / parse | 3 | crafter-station/mermaid | 1.02 | independent attempt |
| er | node:public-api / parse | 4 | neongreen/mermaid-ast | 1.45 | independent attempt |
| er | node:public-api / parse | 5 | adewale/agentic-mermaid | 2.46 | independent attempt |
| sequence | node:public-api / source | 1 | chenyanchen/mermaid-formatter | 0.06 | independent attempt |
| sequence | bun:public-api / svg | 1 | ysknsid25/beautiful-mermaid | 0.07 | independent attempt |
| state | node:public-api / parse | 1 | inkeep/visimer | 0.07 | independent attempt |
| state | node:public-api / parse | 2 | crafter-station/mermaid | 0.26 | independent attempt |
| state | node:public-api / parse | 3 | adewale/agentic-mermaid | 0.76 | independent attempt |
| state | node:public-api / parse | 4 | Dicklesworthstone/frankenmermaid | 0.80 | independent attempt |
| state | node:public-api / parse | 5 | neongreen/mermaid-ast | 0.99 | independent attempt |
| sequence | node:public-api / terminal | 1 | rohitg00/beautiful-mermaid | 0.09 | independent attempt |
| sequence | node:public-api / terminal | 2 | kais-radwan/ascii-mermaid | 0.09 | independent attempt |
| sequence | node:public-api / terminal | 3 | 01colyncelestine-stack/beautiful-mermaid | 0.09 | independent attempt |
| sequence | node:public-api / terminal | 4 | fdotu/beautiful-mermaid | 0.09 | shared: 01colyncelestine-stack/beautiful-mermaid |
| sequence | node:public-api / terminal | 5 | gmh5225/beautiful-mermaid | 0.09 | shared: 01colyncelestine-stack/beautiful-mermaid |
| sequence | node:public-api / terminal | 6 | vercel-labs/beautiful-mermaid | 0.09 | independent attempt |
| sequence | node:public-api / terminal | 7 | theletterf/beautiful-mermaid | 0.09 | independent attempt |
| sequence | node:public-api / terminal | 8 | thepanax/beautiful-mermaid | 0.14 | independent attempt |
| sequence | node:public-api / terminal | 9 | lukilabs/beautiful-mermaid | 0.14 | independent attempt |
| sequence | node:public-api / terminal | 10 | 2233admin/beautiful-mermaid | 0.15 | independent attempt |
| sequence | node:public-api / terminal | 11 | HealthSamurai/beautiful-mermaid | 0.15 | shared: 2233admin/beautiful-mermaid |
| sequence | node:public-api / terminal | 12 | Stars1233/beautiful-mermaid | 0.15 | shared: 2233admin/beautiful-mermaid |
| sequence | node:public-api / terminal | 13 | emtyty/merslim | 0.16 | independent attempt |
| sequence | node:public-api / terminal | 14 | ktrysmt/beautiful-mermaid | 0.19 | independent attempt |
| sequence | node:public-api / terminal | 15 | dfadler/zombie-mermaid | 0.29 | independent attempt |
| sequence | node:public-api / terminal | 16 | npm:tui-mermaid | 0.35 | independent attempt |
| sequence | node:public-api / terminal | 17 | xl0/lovely-mermaid | 0.77 | independent attempt |
| sequence | node:public-api / terminal | 18 | mopi1402/termaid-ts | 0.80 | independent attempt |
| sequence | node:public-api / terminal | 19 | adewale/agentic-mermaid | 3.76 | independent attempt |
| sequence | node:public-api / terminal | 20 | zhenhuaa/mdv | 15.84 | independent attempt |
| sequence | node:public-api / terminal | N/A | tariqshams/mermaidtui | Unqualified | independent attempt |
| flowchart | node:public-api / parse | 1 | inkeep/visimer | 0.11 | independent attempt |
| flowchart | node:public-api / parse | 2 | crafter-station/mermaid | 0.15 | independent attempt |
| flowchart | node:public-api / parse | 3 | Dicklesworthstone/frankenmermaid | 0.62 | independent attempt |
| flowchart | node:public-api / parse | 4 | neongreen/mermaid-ast | 1.97 | independent attempt |
| flowchart | node:public-api / parse | 5 | adewale/agentic-mermaid | 3.60 | independent attempt |
| sequence | bun:public-api / terminal | 1 | ysknsid25/beautiful-mermaid | 0.13 | independent attempt |
| sequence | bun:public-api / terminal | 2 | kitlangton/merman | 0.87 | independent attempt |
| class | node:public-api / parse | 1 | inkeep/visimer | 0.15 | independent attempt |
| class | node:public-api / parse | 2 | Dicklesworthstone/frankenmermaid | 1.04 | independent attempt |
| class | node:public-api / parse | 3 | adewale/agentic-mermaid | 3.83 | independent attempt |
| class | node:public-api / parse | 4 | crafter-station/mermaid | 4.34 | independent attempt |
| class | node:public-api / parse | 5 | neongreen/mermaid-ast | 5.13 | independent attempt |
| er | browser:public-api / svg | 1 | sandyyst/dsh-plugin-mermaid-gb-svg | 0.24 | independent attempt |
| er | browser:public-api / svg | 2 | crabtalk/bezel | 0.52 | independent attempt |
| er | browser:public-api / svg | 3 | wevm/ondine | 0.70 | independent attempt |
| er | browser:public-api / svg | 4 | obsidianmd/pele | 1.01 | independent attempt |
| er | browser:public-api / svg | 5 | Dicklesworthstone/frankenmermaid | 1.20 | independent attempt |
| er | browser:public-api / svg | 6 | orestesgaolin/mermaid | 3.41 | independent attempt |
| er | browser:public-api / svg | 7 | evangwt/xmermaid | 4.75 | independent attempt |
| er | browser:public-api / svg | 8 | toeverything/mermaid-rs-renderer | 8.00 | independent attempt |
| er | browser:public-api / svg | 9 | fdotu/beautiful-mermaid | 8.07 | independent attempt |
| er | browser:public-api / svg | 10 | gmh5225/beautiful-mermaid | 8.55 | independent attempt |
| er | browser:public-api / svg | 11 | theletterf/beautiful-mermaid | 8.75 | independent attempt |
| er | browser:public-api / svg | 12 | vercel-labs/beautiful-mermaid | 8.95 | independent attempt |
| er | browser:public-api / svg | 13 | rohitg00/beautiful-mermaid | 9.05 | independent attempt |
| er | browser:public-api / svg | 14 | 01colyncelestine-stack/beautiful-mermaid | 9.57 | independent attempt |
| er | browser:public-api / svg | 15 | zhenhuaa/mdv | 13.65 | independent attempt |
| er | browser:public-api / svg | 16 | 2233admin/beautiful-mermaid | 14.15 | independent attempt |
| er | browser:public-api / svg | 17 | lukilabs/beautiful-mermaid | 14.40 | independent attempt |
| er | browser:public-api / svg | 18 | ktrysmt/beautiful-mermaid | 14.65 | independent attempt |
| er | browser:public-api / svg | 19 | dfadler/zombie-mermaid | 14.95 | independent attempt |
| er | browser:public-api / svg | 20 | thepanax/beautiful-mermaid | 18.30 | independent attempt |
| er | browser:public-api / svg | 21 | ysknsid25/beautiful-mermaid | 19.70 | independent attempt |
| er | browser:public-api / svg | 22 | HealthSamurai/beautiful-mermaid | 19.80 | independent attempt |
| er | browser:public-api / svg | 23 | Stars1233/beautiful-mermaid | 20.50 | independent attempt |
| er | browser:public-api / svg | 24 | adewale/agentic-mermaid | 22.00 | independent attempt |
| er | browser:public-api / svg | 25 | Latias94/merman | 33.50 | independent attempt |
| er | browser:public-api / svg | 26 | mbostock/mermaid | 62.40 | independent attempt |
| er | browser:public-api / svg | 27 | xeolabs/mermaid | 96.70 | independent attempt |
| er | browser:public-api / svg | 28 | zakaria-forks/mermaid | 97.80 | independent attempt |
| er | browser:public-api / svg | 29 | NicolasNewman/mermaid | 103.80 | independent attempt |
| er | browser:public-api / svg | 30 | Mermaid-Chart/mermaid-develop | 208.10 | independent attempt |
| er | browser:public-api / svg | 31 | jacob-lcs/mermaid | 242.80 | independent attempt |
| er | browser:public-api / svg | 32 | ioggstream/d3fend-mermaid | 273.60 | independent attempt |
| er | browser:public-api / svg | 33 | mermaid-js/mermaid | 371.10 | independent attempt |
| er | browser:public-api / svg | N/A | blackst0ne/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | enrimr/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | jgraph/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | lishid/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | lyngai/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | songshaodong/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | xen3r0/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| er | browser:public-api / svg | N/A | KlangHaus/vitepress-plugin-diagram | Unqualified | independent attempt |
| flowchart | node:public-api / source | 1 | chenyanchen/mermaid-formatter | 0.26 | independent attempt |
| state | node:public-api / source | 1 | chenyanchen/mermaid-formatter | 0.30 | independent attempt |
| sequence | node:public-api / diagnostics | 1 | probelabs/maid | 0.31 | independent attempt |
| sequence | node:public-api / diagnostics | N/A | aj-archipelago/merval | Unqualified | independent attempt |
| er | node:public-api / svg | 1 | wevm/ondine | 0.34 | independent attempt |
| er | node:public-api / svg | 2 | sandyyst/dsh-plugin-mermaid-gb-svg | 0.38 | independent attempt |
| er | node:public-api / svg | 3 | crabtalk/bezel | 0.50 | independent attempt |
| er | node:public-api / svg | 4 | obsidianmd/pele | 0.60 | independent attempt |
| er | node:public-api / svg | 5 | Dicklesworthstone/frankenmermaid | 1.45 | independent attempt |
| er | node:public-api / svg | 6 | orestesgaolin/mermaid | 5.51 | independent attempt |
| er | node:public-api / svg | 7 | vercel-labs/beautiful-mermaid | 6.56 | independent attempt |
| er | node:public-api / svg | 8 | theletterf/beautiful-mermaid | 7.79 | independent attempt |
| er | node:public-api / svg | 9 | rohitg00/beautiful-mermaid | 7.92 | independent attempt |
| er | node:public-api / svg | 10 | toeverything/mermaid-rs-renderer | 8.02 | independent attempt |
| er | node:public-api / svg | 11 | emtyty/merslim | 9.47 | independent attempt |
| er | node:public-api / svg | 12 | 01colyncelestine-stack/beautiful-mermaid | 9.61 | independent attempt |
| er | node:public-api / svg | 13 | fdotu/beautiful-mermaid | 9.61 | shared: 01colyncelestine-stack/beautiful-mermaid |
| er | node:public-api / svg | 14 | gmh5225/beautiful-mermaid | 9.61 | shared: 01colyncelestine-stack/beautiful-mermaid |
| er | node:public-api / svg | 15 | ktrysmt/beautiful-mermaid | 14.01 | independent attempt |
| er | node:public-api / svg | 16 | thepanax/beautiful-mermaid | 14.12 | independent attempt |
| er | node:public-api / svg | 17 | lukilabs/beautiful-mermaid | 15.00 | independent attempt |
| er | node:public-api / svg | 18 | 2233admin/beautiful-mermaid | 16.00 | independent attempt |
| er | node:public-api / svg | 19 | HealthSamurai/beautiful-mermaid | 16.00 | shared: 2233admin/beautiful-mermaid |
| er | node:public-api / svg | 20 | Stars1233/beautiful-mermaid | 16.00 | shared: 2233admin/beautiful-mermaid |
| er | node:public-api / svg | 21 | Latias94/merman | 16.05 | independent attempt |
| er | node:public-api / svg | 22 | zhenhuaa/mdv | 16.74 | independent attempt |
| er | node:public-api / svg | 23 | dfadler/zombie-mermaid | 19.36 | independent attempt |
| er | node:public-api / svg | 24 | adewale/agentic-mermaid | 24.34 | independent attempt |
| er | node:public-api / svg | 25 | woxQAQ/mermaid-rs-render-js | 43.08 | independent attempt |
| er | node:public-api / svg | 26 | akashacms/mermaid-wasm-renderer | 71.59 | independent attempt |
| er | node:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| er | node:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| er | node:public-api / svg | N/A | KlangHaus/vitepress-plugin-diagram | Unqualified | independent attempt |
| sequence | bun:published-renderer-component / terminal | 1 | ramtinJ95/pi-mermaid-tui | 0.36 | independent attempt |
| sequence | bun:published-renderer-component / terminal | 2 | Yassimba/loom | 0.58 | independent attempt |
| flowchart | node:public-api / svg | 1 | wevm/ondine | 0.38 | independent attempt |
| flowchart | node:public-api / svg | 2 | crabtalk/bezel | 0.59 | independent attempt |
| flowchart | node:public-api / svg | 3 | obsidianmd/pele | 0.66 | independent attempt |
| flowchart | node:public-api / svg | 4 | KlangHaus/vitepress-plugin-diagram | 1.30 | independent attempt |
| flowchart | node:public-api / svg | 5 | Dicklesworthstone/frankenmermaid | 1.32 | independent attempt |
| flowchart | node:public-api / svg | 6 | orestesgaolin/mermaid | 4.50 | independent attempt |
| flowchart | node:public-api / svg | 7 | Latias94/merman | 5.08 | independent attempt |
| flowchart | node:public-api / svg | 8 | sandyyst/dsh-plugin-mermaid-gb-svg | 5.60 | independent attempt |
| flowchart | node:public-api / svg | 9 | theletterf/beautiful-mermaid | 10.34 | independent attempt |
| flowchart | node:public-api / svg | 10 | 01colyncelestine-stack/beautiful-mermaid | 11.37 | independent attempt |
| flowchart | node:public-api / svg | 11 | fdotu/beautiful-mermaid | 11.37 | shared: 01colyncelestine-stack/beautiful-mermaid |
| flowchart | node:public-api / svg | 12 | gmh5225/beautiful-mermaid | 11.37 | shared: 01colyncelestine-stack/beautiful-mermaid |
| flowchart | node:public-api / svg | 13 | vercel-labs/beautiful-mermaid | 12.71 | independent attempt |
| flowchart | node:public-api / svg | 14 | rohitg00/beautiful-mermaid | 13.38 | independent attempt |
| flowchart | node:public-api / svg | 15 | toeverything/mermaid-rs-renderer | 13.67 | independent attempt |
| flowchart | node:public-api / svg | 16 | adewale/agentic-mermaid | 14.38 | independent attempt |
| flowchart | node:public-api / svg | 17 | emtyty/merslim | 15.80 | independent attempt |
| flowchart | node:public-api / svg | 18 | dfadler/zombie-mermaid | 29.91 | independent attempt |
| flowchart | node:public-api / svg | 19 | zhenhuaa/mdv | 30.01 | independent attempt |
| flowchart | node:public-api / svg | 20 | 2233admin/beautiful-mermaid | 32.92 | independent attempt |
| flowchart | node:public-api / svg | 21 | HealthSamurai/beautiful-mermaid | 32.92 | shared: 2233admin/beautiful-mermaid |
| flowchart | node:public-api / svg | 22 | Stars1233/beautiful-mermaid | 32.92 | shared: 2233admin/beautiful-mermaid |
| flowchart | node:public-api / svg | 23 | thepanax/beautiful-mermaid | 33.34 | independent attempt |
| flowchart | node:public-api / svg | 24 | ktrysmt/beautiful-mermaid | 34.58 | independent attempt |
| flowchart | node:public-api / svg | 25 | lukilabs/beautiful-mermaid | 35.92 | independent attempt |
| flowchart | node:public-api / svg | 26 | woxQAQ/mermaid-rs-render-js | 344.32 | independent attempt |
| flowchart | node:public-api / svg | 27 | akashacms/mermaid-wasm-renderer | 619.12 | independent attempt |
| flowchart | node:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| flowchart | node:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| state | node:public-api / svg | 1 | wevm/ondine | 0.48 | independent attempt |
| state | node:public-api / svg | 2 | crabtalk/bezel | 0.75 | independent attempt |
| state | node:public-api / svg | 3 | obsidianmd/pele | 1.11 | independent attempt |
| state | node:public-api / svg | 4 | Dicklesworthstone/frankenmermaid | 1.96 | independent attempt |
| state | node:public-api / svg | 5 | sandyyst/dsh-plugin-mermaid-gb-svg | 2.46 | independent attempt |
| state | node:public-api / svg | 6 | Latias94/merman | 7.92 | independent attempt |
| state | node:public-api / svg | 7 | orestesgaolin/mermaid | 10.52 | independent attempt |
| state | node:public-api / svg | 8 | adewale/agentic-mermaid | 21.66 | independent attempt |
| state | node:public-api / svg | 9 | theletterf/beautiful-mermaid | 22.28 | independent attempt |
| state | node:public-api / svg | 10 | rohitg00/beautiful-mermaid | 22.72 | independent attempt |
| state | node:public-api / svg | 11 | vercel-labs/beautiful-mermaid | 24.13 | independent attempt |
| state | node:public-api / svg | 12 | 01colyncelestine-stack/beautiful-mermaid | 24.23 | independent attempt |
| state | node:public-api / svg | 13 | fdotu/beautiful-mermaid | 24.23 | shared: 01colyncelestine-stack/beautiful-mermaid |
| state | node:public-api / svg | 14 | gmh5225/beautiful-mermaid | 24.23 | shared: 01colyncelestine-stack/beautiful-mermaid |
| state | node:public-api / svg | 15 | toeverything/mermaid-rs-renderer | 28.18 | independent attempt |
| state | node:public-api / svg | 16 | dfadler/zombie-mermaid | 44.83 | independent attempt |
| state | node:public-api / svg | 17 | ktrysmt/beautiful-mermaid | 55.70 | independent attempt |
| state | node:public-api / svg | 18 | zhenhuaa/mdv | 72.91 | independent attempt |
| state | node:public-api / svg | 19 | lukilabs/beautiful-mermaid | 74.46 | independent attempt |
| state | node:public-api / svg | 20 | 2233admin/beautiful-mermaid | 76.23 | independent attempt |
| state | node:public-api / svg | 21 | HealthSamurai/beautiful-mermaid | 76.23 | shared: 2233admin/beautiful-mermaid |
| state | node:public-api / svg | 22 | Stars1233/beautiful-mermaid | 76.23 | shared: 2233admin/beautiful-mermaid |
| state | node:public-api / svg | 23 | thepanax/beautiful-mermaid | 77.71 | independent attempt |
| state | node:public-api / svg | 24 | woxQAQ/mermaid-rs-render-js | 86.76 | independent attempt |
| state | node:public-api / svg | 25 | akashacms/mermaid-wasm-renderer | 183.46 | independent attempt |
| state | node:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| state | node:public-api / svg | N/A | emtyty/merslim | Unqualified | independent attempt |
| state | node:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| state | node:public-api / svg | N/A | KlangHaus/vitepress-plugin-diagram | Unqualified | independent attempt |
| class | node:public-api / svg | 1 | wevm/ondine | 0.48 | independent attempt |
| class | node:public-api / svg | 2 | crabtalk/bezel | 0.72 | independent attempt |
| class | node:public-api / svg | 3 | obsidianmd/pele | 1.03 | independent attempt |
| class | node:public-api / svg | 4 | Dicklesworthstone/frankenmermaid | 1.76 | independent attempt |
| class | node:public-api / svg | 5 | KlangHaus/vitepress-plugin-diagram | 3.24 | independent attempt |
| class | node:public-api / svg | 6 | orestesgaolin/mermaid | 6.88 | independent attempt |
| class | node:public-api / svg | 7 | Latias94/merman | 13.73 | independent attempt |
| class | node:public-api / svg | 8 | rohitg00/beautiful-mermaid | 17.72 | independent attempt |
| class | node:public-api / svg | 9 | vercel-labs/beautiful-mermaid | 18.08 | independent attempt |
| class | node:public-api / svg | 10 | 01colyncelestine-stack/beautiful-mermaid | 18.81 | independent attempt |
| class | node:public-api / svg | 11 | fdotu/beautiful-mermaid | 18.81 | shared: 01colyncelestine-stack/beautiful-mermaid |
| class | node:public-api / svg | 12 | gmh5225/beautiful-mermaid | 18.81 | shared: 01colyncelestine-stack/beautiful-mermaid |
| class | node:public-api / svg | 13 | toeverything/mermaid-rs-renderer | 18.88 | independent attempt |
| class | node:public-api / svg | 14 | theletterf/beautiful-mermaid | 18.99 | independent attempt |
| class | node:public-api / svg | 15 | lukilabs/beautiful-mermaid | 19.79 | independent attempt |
| class | node:public-api / svg | 16 | thepanax/beautiful-mermaid | 20.02 | independent attempt |
| class | node:public-api / svg | 17 | ktrysmt/beautiful-mermaid | 20.09 | independent attempt |
| class | node:public-api / svg | 18 | zhenhuaa/mdv | 20.41 | independent attempt |
| class | node:public-api / svg | 19 | 2233admin/beautiful-mermaid | 21.73 | independent attempt |
| class | node:public-api / svg | 20 | HealthSamurai/beautiful-mermaid | 21.73 | shared: 2233admin/beautiful-mermaid |
| class | node:public-api / svg | 21 | Stars1233/beautiful-mermaid | 21.73 | shared: 2233admin/beautiful-mermaid |
| class | node:public-api / svg | 22 | emtyty/merslim | 23.84 | independent attempt |
| class | node:public-api / svg | 23 | dfadler/zombie-mermaid | 29.46 | independent attempt |
| class | node:public-api / svg | 24 | adewale/agentic-mermaid | 31.33 | independent attempt |
| class | node:public-api / svg | 25 | woxQAQ/mermaid-rs-render-js | 56.29 | independent attempt |
| class | node:public-api / svg | 26 | akashacms/mermaid-wasm-renderer | 102.58 | independent attempt |
| class | node:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| class | node:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| class | node:public-api / svg | N/A | sandyyst/dsh-plugin-mermaid-gb-svg | Unqualified | independent attempt |
| er | node:public-api / source | 1 | chenyanchen/mermaid-formatter | 0.60 | independent attempt |
| sequence | python:public-api / terminal | 1 | fasouto/termaid | 0.64 | independent attempt |
| state | node:public-api / diagnostics | 1 | probelabs/maid | 0.64 | independent attempt |
| state | node:public-api / diagnostics | N/A | aj-archipelago/merval | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | 1 | crabtalk/bezel | 0.66 | independent attempt |
| flowchart | browser:public-api / svg | 2 | wevm/ondine | 0.71 | independent attempt |
| flowchart | browser:public-api / svg | 3 | obsidianmd/pele | 0.90 | independent attempt |
| flowchart | browser:public-api / svg | 4 | KlangHaus/vitepress-plugin-diagram | 1.08 | independent attempt |
| flowchart | browser:public-api / svg | 5 | Dicklesworthstone/frankenmermaid | 1.63 | independent attempt |
| flowchart | browser:public-api / svg | 6 | orestesgaolin/mermaid | 3.14 | independent attempt |
| flowchart | browser:public-api / svg | 7 | evangwt/xmermaid | 3.23 | independent attempt |
| flowchart | browser:public-api / svg | 8 | sandyyst/dsh-plugin-mermaid-gb-svg | 4.79 | independent attempt |
| flowchart | browser:public-api / svg | 9 | fdotu/beautiful-mermaid | 10.01 | independent attempt |
| flowchart | browser:public-api / svg | 10 | rohitg00/beautiful-mermaid | 10.15 | independent attempt |
| flowchart | browser:public-api / svg | 11 | gmh5225/beautiful-mermaid | 10.52 | independent attempt |
| flowchart | browser:public-api / svg | 12 | theletterf/beautiful-mermaid | 10.53 | independent attempt |
| flowchart | browser:public-api / svg | 13 | vercel-labs/beautiful-mermaid | 10.99 | independent attempt |
| flowchart | browser:public-api / svg | 14 | 01colyncelestine-stack/beautiful-mermaid | 11.01 | independent attempt |
| flowchart | browser:public-api / svg | 15 | adewale/agentic-mermaid | 13.38 | independent attempt |
| flowchart | browser:public-api / svg | 16 | toeverything/mermaid-rs-renderer | 17.27 | independent attempt |
| flowchart | browser:public-api / svg | 17 | Latias94/merman | 28.50 | independent attempt |
| flowchart | browser:public-api / svg | 18 | dfadler/zombie-mermaid | 28.65 | independent attempt |
| flowchart | browser:public-api / svg | 19 | zhenhuaa/mdv | 29.35 | independent attempt |
| flowchart | browser:public-api / svg | 20 | Stars1233/beautiful-mermaid | 32.08 | independent attempt |
| flowchart | browser:public-api / svg | 21 | HealthSamurai/beautiful-mermaid | 33.25 | independent attempt |
| flowchart | browser:public-api / svg | 22 | ktrysmt/beautiful-mermaid | 33.47 | independent attempt |
| flowchart | browser:public-api / svg | 23 | thepanax/beautiful-mermaid | 34.73 | independent attempt |
| flowchart | browser:public-api / svg | 24 | lukilabs/beautiful-mermaid | 37.10 | independent attempt |
| flowchart | browser:public-api / svg | 25 | 2233admin/beautiful-mermaid | 38.72 | independent attempt |
| flowchart | browser:public-api / svg | 26 | ysknsid25/beautiful-mermaid | 44.15 | independent attempt |
| flowchart | browser:public-api / svg | 27 | lishid/mermaid | 77.90 | independent attempt |
| flowchart | browser:public-api / svg | 28 | mbostock/mermaid | 81.85 | independent attempt |
| flowchart | browser:public-api / svg | 29 | jacob-lcs/mermaid | 114.30 | independent attempt |
| flowchart | browser:public-api / svg | 30 | NicolasNewman/mermaid | 116.20 | independent attempt |
| flowchart | browser:public-api / svg | 31 | xeolabs/mermaid | 121.00 | independent attempt |
| flowchart | browser:public-api / svg | 32 | ioggstream/d3fend-mermaid | 136.00 | independent attempt |
| flowchart | browser:public-api / svg | 33 | mermaid-js/mermaid | 277.10 | independent attempt |
| flowchart | browser:public-api / svg | N/A | blackst0ne/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | enrimr/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | jgraph/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | lyngai/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | Mermaid-Chart/mermaid-develop | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | songshaodong/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | xen3r0/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | zakaria-forks/mermaid | Unqualified | independent attempt |
| flowchart | browser:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| flowchart | bun:published-renderer-component / terminal | 1 | ramtinJ95/pi-mermaid-tui | 0.69 | independent attempt |
| flowchart | bun:published-renderer-component / terminal | 2 | Yassimba/loom | 3.98 | independent attempt |
| class | browser:public-api / svg | 1 | crabtalk/bezel | 0.72 | independent attempt |
| class | browser:public-api / svg | 2 | obsidianmd/pele | 0.97 | independent attempt |
| class | browser:public-api / svg | 3 | wevm/ondine | 1.00 | independent attempt |
| class | browser:public-api / svg | 4 | Dicklesworthstone/frankenmermaid | 1.58 | independent attempt |
| class | browser:public-api / svg | 5 | KlangHaus/vitepress-plugin-diagram | 2.78 | independent attempt |
| class | browser:public-api / svg | 6 | orestesgaolin/mermaid | 5.17 | independent attempt |
| class | browser:public-api / svg | 7 | theletterf/beautiful-mermaid | 13.60 | independent attempt |
| class | browser:public-api / svg | 8 | 01colyncelestine-stack/beautiful-mermaid | 14.10 | independent attempt |
| class | browser:public-api / svg | 9 | vercel-labs/beautiful-mermaid | 14.25 | independent attempt |
| class | browser:public-api / svg | 10 | fdotu/beautiful-mermaid | 14.40 | independent attempt |
| class | browser:public-api / svg | 11 | rohitg00/beautiful-mermaid | 14.90 | independent attempt |
| class | browser:public-api / svg | 12 | gmh5225/beautiful-mermaid | 16.30 | independent attempt |
| class | browser:public-api / svg | 13 | toeverything/mermaid-rs-renderer | 20.65 | independent attempt |
| class | browser:public-api / svg | 14 | zhenhuaa/mdv | 21.40 | independent attempt |
| class | browser:public-api / svg | 15 | Stars1233/beautiful-mermaid | 22.10 | independent attempt |
| class | browser:public-api / svg | 16 | ktrysmt/beautiful-mermaid | 23.50 | independent attempt |
| class | browser:public-api / svg | 17 | 2233admin/beautiful-mermaid | 24.20 | independent attempt |
| class | browser:public-api / svg | 18 | lukilabs/beautiful-mermaid | 24.30 | independent attempt |
| class | browser:public-api / svg | 19 | ysknsid25/beautiful-mermaid | 24.50 | independent attempt |
| class | browser:public-api / svg | 20 | HealthSamurai/beautiful-mermaid | 24.80 | independent attempt |
| class | browser:public-api / svg | 21 | thepanax/beautiful-mermaid | 26.10 | independent attempt |
| class | browser:public-api / svg | 22 | dfadler/zombie-mermaid | 31.70 | independent attempt |
| class | browser:public-api / svg | 23 | adewale/agentic-mermaid | 32.10 | independent attempt |
| class | browser:public-api / svg | 24 | Latias94/merman | 43.30 | independent attempt |
| class | browser:public-api / svg | 25 | enrimr/mermaid | 52.60 | independent attempt |
| class | browser:public-api / svg | 26 | lyngai/mermaid | 55.20 | independent attempt |
| class | browser:public-api / svg | 27 | lishid/mermaid | 58.10 | independent attempt |
| class | browser:public-api / svg | 28 | mbostock/mermaid | 174.10 | independent attempt |
| class | browser:public-api / svg | 29 | xeolabs/mermaid | 227.60 | independent attempt |
| class | browser:public-api / svg | 30 | ioggstream/d3fend-mermaid | 414.60 | independent attempt |
| class | browser:public-api / svg | 31 | NicolasNewman/mermaid | 424.80 | independent attempt |
| class | browser:public-api / svg | 32 | jacob-lcs/mermaid | 438.00 | independent attempt |
| class | browser:public-api / svg | 33 | mermaid-js/mermaid | 1054.00 | independent attempt |
| class | browser:public-api / svg | N/A | blackst0ne/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | jgraph/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | Mermaid-Chart/mermaid-develop | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | songshaodong/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | xen3r0/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | zakaria-forks/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | evangwt/xmermaid | Unqualified | independent attempt |
| class | browser:public-api / svg | N/A | sandyyst/dsh-plugin-mermaid-gb-svg | Unqualified | independent attempt |
| state | browser:public-api / svg | 1 | crabtalk/bezel | 0.73 | independent attempt |
| state | browser:public-api / svg | 2 | wevm/ondine | 0.92 | independent attempt |
| state | browser:public-api / svg | 3 | obsidianmd/pele | 1.36 | independent attempt |
| state | browser:public-api / svg | 4 | Dicklesworthstone/frankenmermaid | 1.60 | independent attempt |
| state | browser:public-api / svg | 5 | sandyyst/dsh-plugin-mermaid-gb-svg | 2.08 | independent attempt |
| state | browser:public-api / svg | 6 | evangwt/xmermaid | 5.40 | independent attempt |
| state | browser:public-api / svg | 7 | orestesgaolin/mermaid | 8.17 | independent attempt |
| state | browser:public-api / svg | 8 | gmh5225/beautiful-mermaid | 17.90 | independent attempt |
| state | browser:public-api / svg | 9 | 01colyncelestine-stack/beautiful-mermaid | 20.15 | independent attempt |
| state | browser:public-api / svg | 10 | rohitg00/beautiful-mermaid | 20.50 | independent attempt |
| state | browser:public-api / svg | 11 | vercel-labs/beautiful-mermaid | 20.90 | independent attempt |
| state | browser:public-api / svg | 12 | fdotu/beautiful-mermaid | 21.90 | independent attempt |
| state | browser:public-api / svg | 13 | adewale/agentic-mermaid | 23.10 | independent attempt |
| state | browser:public-api / svg | 14 | theletterf/beautiful-mermaid | 23.80 | independent attempt |
| state | browser:public-api / svg | 15 | Latias94/merman | 25.00 | independent attempt |
| state | browser:public-api / svg | 16 | toeverything/mermaid-rs-renderer | 28.10 | independent attempt |
| state | browser:public-api / svg | 17 | dfadler/zombie-mermaid | 42.40 | independent attempt |
| state | browser:public-api / svg | 18 | ktrysmt/beautiful-mermaid | 48.10 | independent attempt |
| state | browser:public-api / svg | 19 | HealthSamurai/beautiful-mermaid | 72.10 | independent attempt |
| state | browser:public-api / svg | 20 | Stars1233/beautiful-mermaid | 73.10 | independent attempt |
| state | browser:public-api / svg | 21 | 2233admin/beautiful-mermaid | 74.80 | independent attempt |
| state | browser:public-api / svg | 22 | zhenhuaa/mdv | 75.60 | independent attempt |
| state | browser:public-api / svg | 23 | lukilabs/beautiful-mermaid | 76.30 | independent attempt |
| state | browser:public-api / svg | 24 | thepanax/beautiful-mermaid | 77.60 | independent attempt |
| state | browser:public-api / svg | 25 | ysknsid25/beautiful-mermaid | 82.80 | independent attempt |
| state | browser:public-api / svg | 26 | lishid/mermaid | 100.00 | independent attempt |
| state | browser:public-api / svg | 27 | mbostock/mermaid | 106.70 | independent attempt |
| state | browser:public-api / svg | 28 | xeolabs/mermaid | 159.30 | independent attempt |
| state | browser:public-api / svg | 29 | NicolasNewman/mermaid | 204.70 | independent attempt |
| state | browser:public-api / svg | 30 | jacob-lcs/mermaid | 388.10 | independent attempt |
| state | browser:public-api / svg | 31 | ioggstream/d3fend-mermaid | 410.50 | independent attempt |
| state | browser:public-api / svg | 32 | mermaid-js/mermaid | 595.40 | independent attempt |
| state | browser:public-api / svg | N/A | blackst0ne/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | enrimr/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | jgraph/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | lyngai/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | Mermaid-Chart/mermaid-develop | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | songshaodong/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | xen3r0/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | zakaria-forks/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | crafter-station/mermaid | Unqualified | independent attempt |
| state | browser:public-api / svg | N/A | KlangHaus/vitepress-plugin-diagram | Unqualified | independent attempt |
| flowchart | node:public-api / terminal | 1 | npm:tui-mermaid | 0.82 | independent attempt |
| flowchart | node:public-api / terminal | 2 | xl0/lovely-mermaid | 2.48 | independent attempt |
| flowchart | node:public-api / terminal | 3 | dfadler/zombie-mermaid | 14.65 | independent attempt |
| flowchart | node:public-api / terminal | 4 | emtyty/merslim | 18.98 | independent attempt |
| flowchart | node:public-api / terminal | 5 | adewale/agentic-mermaid | 43.95 | independent attempt |
| flowchart | node:public-api / terminal | 6 | mopi1402/termaid-ts | 44.08 | independent attempt |
| flowchart | node:public-api / terminal | 7 | rohitg00/beautiful-mermaid | 87.31 | independent attempt |
| flowchart | node:public-api / terminal | 8 | 01colyncelestine-stack/beautiful-mermaid | 87.64 | independent attempt |
| flowchart | node:public-api / terminal | 9 | fdotu/beautiful-mermaid | 87.64 | shared: 01colyncelestine-stack/beautiful-mermaid |
| flowchart | node:public-api / terminal | 10 | gmh5225/beautiful-mermaid | 87.64 | shared: 01colyncelestine-stack/beautiful-mermaid |
| flowchart | node:public-api / terminal | 11 | theletterf/beautiful-mermaid | 93.24 | independent attempt |
| flowchart | node:public-api / terminal | 12 | kais-radwan/ascii-mermaid | 96.21 | independent attempt |
| flowchart | node:public-api / terminal | 13 | vercel-labs/beautiful-mermaid | 96.84 | independent attempt |
| flowchart | node:public-api / terminal | 14 | thepanax/beautiful-mermaid | 157.05 | independent attempt |
| flowchart | node:public-api / terminal | 15 | 2233admin/beautiful-mermaid | 159.35 | independent attempt |
| flowchart | node:public-api / terminal | 16 | HealthSamurai/beautiful-mermaid | 159.35 | shared: 2233admin/beautiful-mermaid |
| flowchart | node:public-api / terminal | 17 | Stars1233/beautiful-mermaid | 159.35 | shared: 2233admin/beautiful-mermaid |
| flowchart | node:public-api / terminal | 18 | ktrysmt/beautiful-mermaid | 173.48 | independent attempt |
| flowchart | node:public-api / terminal | 19 | lukilabs/beautiful-mermaid | 175.91 | independent attempt |
| flowchart | node:public-api / terminal | 20 | zhenhuaa/mdv | 1135.19 | independent attempt |
| flowchart | node:public-api / terminal | N/A | tariqshams/mermaidtui | Unqualified | independent attempt |
| class | node:public-api / diagnostics | 1 | probelabs/maid | 0.90 | independent attempt |
| class | node:public-api / diagnostics | N/A | aj-archipelago/merval | Unqualified | independent attempt |
| class | node:public-api / source | 1 | chenyanchen/mermaid-formatter | 1.08 | independent attempt |
| flowchart | node:public-api / diagnostics | 1 | probelabs/maid | 1.71 | independent attempt |
| flowchart | node:public-api / diagnostics | N/A | aj-archipelago/merval | Unqualified | independent attempt |
| flowchart | bun:public-api / terminal | 1 | kitlangton/merman | 4.07 | independent attempt |
| flowchart | bun:public-api / terminal | 2 | ysknsid25/beautiful-mermaid | 78.57 | independent attempt |
| sequence | bun:opentui-headless-integration / terminal | 1 | anomalyco/opencode | 4.87 | independent attempt |
| sequence | bun:opentui-headless-integration / terminal | 2 | 4nkitd/opencode-merman | 6.76 | independent attempt |
| flowchart | node:public-api / react-flow | 1 | taoche/mermaid-reactflow-render | 9.42 | independent attempt |
| sequence | node:public-parse-validation / parse | 1 | mermaid-js/mermaid | 11.62 | independent attempt |
| sequence | browser:react-component / svg | 1 | emtyty/merslim | 16.30 | independent attempt |
| er | bun:public-api / svg | 1 | ysknsid25/beautiful-mermaid | 16.43 | independent attempt |
| er | node:public-parse-validation / parse | 1 | mermaid-js/mermaid | 17.33 | independent attempt |
| class | bun:public-api / svg | 1 | ysknsid25/beautiful-mermaid | 22.04 | independent attempt |
| er | browser:react-component / svg | 1 | emtyty/merslim | 24.30 | independent attempt |
| state | node:public-api / react-flow | 1 | taoche/mermaid-reactflow-render | 26.64 | independent attempt |
| flowchart | browser:react-component / svg | 1 | emtyty/merslim | 33.05 | independent attempt |
| flowchart | python:public-api / terminal | 1 | fasouto/termaid | 34.03 | independent attempt |
| state | browser:react-component / svg | 1 | emtyty/merslim | 40.20 | independent attempt |
| flowchart | bun:public-api / svg | 1 | ysknsid25/beautiful-mermaid | 42.46 | independent attempt |
| sequence | browser:react-component / png | 1 | emtyty/merslim | 45.20 | independent attempt |
| flowchart | node:public-parse-validation / parse | 1 | mermaid-js/mermaid | 47.04 | independent attempt |
| class | browser:react-component / svg | 1 | emtyty/merslim | 47.40 | independent attempt |
| sequence | node:public-api / png | 1 | adewale/agentic-mermaid | 70.04 | independent attempt |
| sequence | node:public-api / png | N/A | emtyty/merslim | Unqualified | independent attempt |
| sequence | node:public-api / png | N/A | Latias94/merman | Unqualified | independent attempt |
| state | bun:public-api / svg | 1 | ysknsid25/beautiful-mermaid | 87.20 | independent attempt |
| state | browser:react-component / png | 1 | emtyty/merslim | 121.50 | independent attempt |
| state | node:public-parse-validation / parse | 1 | mermaid-js/mermaid | 128.60 | independent attempt |
| flowchart | browser:react-component / png | 1 | emtyty/merslim | 133.40 | independent attempt |
| flowchart | bun:opentui-headless-integration / terminal | 1 | anomalyco/opencode | 138.03 | independent attempt |
| flowchart | bun:opentui-headless-integration / terminal | 2 | 4nkitd/opencode-merman | 277.43 | independent attempt |
| er | browser:react-component / png | 1 | emtyty/merslim | 158.60 | independent attempt |
| flowchart | node:public-api / png | 1 | adewale/agentic-mermaid | 174.64 | independent attempt |
| flowchart | node:public-api / png | N/A | emtyty/merslim | Unqualified | independent attempt |
| flowchart | node:public-api / png | N/A | Latias94/merman | Unqualified | independent attempt |
| class | browser:react-component / png | 1 | emtyty/merslim | 275.50 | independent attempt |
| class | node:public-parse-validation / parse | 1 | mermaid-js/mermaid | 619.94 | independent attempt |
| class | node:public-api / png | N/A | adewale/agentic-mermaid | Unqualified | independent attempt |
| class | node:public-api / png | N/A | emtyty/merslim | Unqualified | independent attempt |
| class | node:public-api / png | N/A | Latias94/merman | Unqualified | independent attempt |
| er | node:public-api / png | N/A | adewale/agentic-mermaid | Unqualified | independent attempt |
| er | node:public-api / png | N/A | emtyty/merslim | Unqualified | independent attempt |
| er | node:public-api / png | N/A | Latias94/merman | Unqualified | independent attempt |
| state | node:public-api / png | N/A | adewale/agentic-mermaid | Unqualified | independent attempt |
| state | node:public-api / png | N/A | emtyty/merslim | Unqualified | independent attempt |
| state | node:public-api / png | N/A | Latias94/merman | Unqualified | independent attempt |
| er | node:public-api / diagnostics | N/A | aj-archipelago/merval | Unqualified | independent attempt |
| er | node:public-api / diagnostics | N/A | probelabs/maid | Unqualified | independent attempt |
| sequence | node:public-api / react-flow | N/A | taoche/mermaid-reactflow-render | Unqualified | independent attempt |
| class | node:public-api / react-flow | N/A | taoche/mermaid-reactflow-render | Unqualified | independent attempt |
| er | node:public-api / react-flow | N/A | taoche/mermaid-reactflow-render | Unqualified | independent attempt |
| class | cli:end-to-end / svg | 1 | 1jehuang/mermaid-rs-renderer | 63.95 | independent attempt |
| class | cli:end-to-end / svg | 2 | adewale/agentic-mermaid#node-cli | 686.37 | independent attempt |
| class | cli:end-to-end / svg | 3 | adewale/agentic-mermaid#native-cli | 779.59 | independent attempt |
| er | cli:end-to-end / svg | 1 | 1jehuang/mermaid-rs-renderer | 51.39 | independent attempt |
| er | cli:end-to-end / svg | 2 | adewale/agentic-mermaid#node-cli | 645.05 | independent attempt |
| er | cli:end-to-end / svg | 3 | adewale/agentic-mermaid#native-cli | 690.84 | independent attempt |
| flowchart | cli:end-to-end / svg | 1 | 1jehuang/mermaid-rs-renderer | 386.54 | independent attempt |
| flowchart | cli:end-to-end / svg | 2 | adewale/agentic-mermaid#native-cli | 948.38 | independent attempt |
| flowchart | cli:end-to-end / svg | 3 | adewale/agentic-mermaid#node-cli | 974.22 | independent attempt |
| sequence | cli:end-to-end / svg | 1 | 1jehuang/mermaid-rs-renderer | 5.36 | independent attempt |
| sequence | cli:end-to-end / svg | 2 | adewale/agentic-mermaid#native-cli | 305.26 | independent attempt |
| sequence | cli:end-to-end / svg | 3 | adewale/agentic-mermaid#node-cli | 333.20 | independent attempt |
| state | cli:end-to-end / svg | 1 | 1jehuang/mermaid-rs-renderer | 102.01 | independent attempt |
| state | cli:end-to-end / svg | 2 | adewale/agentic-mermaid#node-cli | 823.12 | independent attempt |
| state | cli:end-to-end / svg | 3 | adewale/agentic-mermaid#native-cli | 918.53 | independent attempt |
| flowchart | cli:end-to-end / terminal | 1 | xai-org/grok-build | 2.93 | independent attempt |
| flowchart | cli:end-to-end / terminal | 2 | Mootikins/figurehead-rs | 3.17 | independent attempt |
| flowchart | cli:end-to-end / terminal | 3 | spacedock-dev/mermaidtext | 3.69 | independent attempt |
| flowchart | cli:end-to-end / terminal | 4 | CaptainCrouton89/mermaid-ascii | 160.61 | independent attempt |
| flowchart | cli:end-to-end / terminal | 5 | Chronostasys/mermaid-ascii | 162.67 | independent attempt |
| flowchart | cli:end-to-end / terminal | 6 | AlexanderGrooff/mermaid-ascii | 164.83 | independent attempt |
| flowchart | cli:end-to-end / terminal | 7 | pgavlin/mermaid-ascii | 167.86 | independent attempt |
| flowchart | cli:end-to-end / terminal | 8 | ktrysmt/mermaid-ascii | 198.70 | independent attempt |
| flowchart | cli:end-to-end / terminal | 9 | app-creative/mermaid-ascii | 200.19 | independent attempt |
| flowchart | cli:end-to-end / terminal | 10 | ColtWindy/mermaid-ascii | 203.54 | independent attempt |
| flowchart | cli:end-to-end / terminal | 11 | sgryjp/mermaid-ascii | 205.08 | independent attempt |
| flowchart | cli:end-to-end / terminal | 12 | catdevman/mermaid-ascii | 205.12 | independent attempt |
| flowchart | cli:end-to-end / terminal | 13 | jeis4wpi/mermaid-ascii | 209.03 | independent attempt |
| flowchart | cli:end-to-end / terminal | 14 | dydoc/mermaid-ascii | 211.57 | independent attempt |
| flowchart | cli:end-to-end / terminal | 15 | leonj1/mermaid-ascii | 218.02 | independent attempt |
| flowchart | cli:end-to-end / terminal | 16 | Aurelian-Shuttleworth/mermaid-ascii | 224.32 | independent attempt |
| flowchart | cli:end-to-end / terminal | 17 | mopi1402/termaid | 525.24 | independent attempt |
| flowchart | cli:end-to-end / terminal | 18 | adewale/agentic-mermaid#node-cli | 952.68 | independent attempt |
| flowchart | cli:end-to-end / terminal | 19 | adewale/agentic-mermaid#native-cli | 1002.24 | independent attempt |
| flowchart | cli:end-to-end / terminal | 20 | Orbiter/beautiful-mermaid-py | 1426.19 | independent attempt |
| flowchart | cli:end-to-end / terminal | N/A | drunkhacker/mermaid-ascii | Unqualified | independent attempt |
| flowchart | cli:end-to-end / terminal | N/A | kingsword09/mermansi | Unqualified | independent attempt |
| sequence | cli:end-to-end / terminal | 1 | spacedock-dev/mermaidtext | 1.36 | independent attempt |
| sequence | cli:end-to-end / terminal | 2 | xai-org/grok-build | 1.44 | independent attempt |
| sequence | cli:end-to-end / terminal | 3 | ColtWindy/mermaid-ascii | 7.97 | independent attempt |
| sequence | cli:end-to-end / terminal | 4 | drunkhacker/mermaid-ascii | 8.02 | independent attempt |
| sequence | cli:end-to-end / terminal | 5 | Chronostasys/mermaid-ascii | 8.06 | independent attempt |
| sequence | cli:end-to-end / terminal | 6 | leonj1/mermaid-ascii | 8.30 | independent attempt |
| sequence | cli:end-to-end / terminal | 7 | catdevman/mermaid-ascii | 8.31 | independent attempt |
| sequence | cli:end-to-end / terminal | 8 | dydoc/mermaid-ascii | 8.62 | independent attempt |
| sequence | cli:end-to-end / terminal | 9 | jeis4wpi/mermaid-ascii | 8.66 | independent attempt |
| sequence | cli:end-to-end / terminal | 10 | AlexanderGrooff/mermaid-ascii | 8.66 | independent attempt |
| sequence | cli:end-to-end / terminal | 11 | ktrysmt/mermaid-ascii | 8.78 | independent attempt |
| sequence | cli:end-to-end / terminal | 12 | pgavlin/mermaid-ascii | 8.85 | independent attempt |
| sequence | cli:end-to-end / terminal | 13 | CaptainCrouton89/mermaid-ascii | 9.07 | independent attempt |
| sequence | cli:end-to-end / terminal | 14 | app-creative/mermaid-ascii | 9.17 | independent attempt |
| sequence | cli:end-to-end / terminal | 15 | Aurelian-Shuttleworth/mermaid-ascii | 9.33 | independent attempt |
| sequence | cli:end-to-end / terminal | 16 | sgryjp/mermaid-ascii | 10.54 | independent attempt |
| sequence | cli:end-to-end / terminal | 17 | Orbiter/beautiful-mermaid-py | 75.41 | independent attempt |
| sequence | cli:end-to-end / terminal | 18 | mopi1402/termaid | 159.56 | independent attempt |
| sequence | cli:end-to-end / terminal | 19 | adewale/agentic-mermaid#native-cli | 287.78 | independent attempt |
| sequence | cli:end-to-end / terminal | 20 | adewale/agentic-mermaid#node-cli | 310.39 | independent attempt |
| sequence | cli:end-to-end / terminal | N/A | kingsword09/mermansi | Unqualified | independent attempt |
| sequence | cli:end-to-end / terminal | N/A | Mootikins/figurehead-rs | Unqualified | independent attempt |

CLI ranks use the separate fresh matched cohort **2026-10-24T21:16:33.300Z → 2026-10-24T22:03:34.154Z**, with 3 rounds. Agentic Mermaid #node-cli/#native-cli are invocation variants of one catalog tool. The supplemental phase adds no broad feature-coverage claims. Original API/browser timings retain their own phase.

## Observed feature-corpus coverage

These are operation-specific outcomes, not a universal fidelity score. SVG/terminal qualification checks output envelopes and authored labels; parser/IR/source operations retain their own scopes. A diagnostic operation may complete with rejection findings; diagnostic acceptance is shown separately and is not an independently established feature oracle.

| Implementation | Surface | Format | Operation-complete / attempted observations | Families with operation completion | Diagnostic accepted / completed with acceptance recorded |
|---|---|---|---:|---:|---:|
| Dicklesworthstone/frankenmermaid | node:public-api | parse | 810 / 957 | 23 | N/A |
| ramtinJ95/pi-mermaid-tui | bun:published-renderer-component | terminal | 452 / 927 | 17 | N/A |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| 2233admin/beautiful-mermaid | node:public-api | terminal | 211 / 927 | 6 | N/A |
| adewale/agentic-mermaid | node:public-api | terminal | 866 / 927 | 23 | N/A |
| adewale/agentic-mermaid | node:public-api | png | 906 / 927 | 23 | N/A |
| adewale/agentic-mermaid | node:public-api | parse | 866 / 957 | 22 | N/A |
| app-creative/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| CaptainCrouton89/mermaid-ascii | cli:end-to-end | terminal | 79 / 927 | 2 | N/A |
| Chronostasys/mermaid-ascii | cli:end-to-end | terminal | 359 / 927 | 18 | N/A |
| ColtWindy/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| dfadler/zombie-mermaid | node:public-api | terminal | 457 / 927 | 9 | N/A |
| drunkhacker/mermaid-ascii | cli:end-to-end | terminal | 85 / 927 | 2 | N/A |
| ktrysmt/beautiful-mermaid | node:public-api | terminal | 212 / 927 | 6 | N/A |
| ktrysmt/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| mopi1402/termaid | cli:end-to-end | terminal | 599 / 927 | 21 | N/A |
| Orbiter/beautiful-mermaid-py | cli:end-to-end | terminal | 233 / 927 | 5 | N/A |
| pgavlin/mermaid-ascii | cli:end-to-end | terminal | 359 / 927 | 18 | N/A |
| rohitg00/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| theletterf/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| thepanax/beautiful-mermaid | node:public-api | terminal | 211 / 927 | 6 | N/A |
| vercel-labs/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| ysknsid25/beautiful-mermaid | bun:public-api | terminal | 204 / 927 | 5 | N/A |
| zhenhuaa/mdv | node:public-api | terminal | 210 / 927 | 6 | N/A |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | png | 922 / 927 | 23 | N/A |
| aj-archipelago/merval | node:public-api | diagnostics | 633 / 957 | 12 | 477 / 633 |
| AlexanderGrooff/mermaid-ascii | cli:end-to-end | terminal | 234 / 927 | 3 | N/A |
| anomalyco/opencode | bun:opentui-headless-integration | terminal | 187 / 927 | 6 | N/A |
| chenyanchen/mermaid-formatter | node:public-api | source | 927 / 927 | 23 | N/A |
| crafter-station/mermaid | node:public-api | parse | 250 / 957 | 7 | N/A |
| emtyty/merslim | node:public-api | png | 0 / 927 | 0 | N/A |
| emtyty/merslim | node:public-api | terminal | 332 / 927 | 14 | N/A |
| fasouto/termaid | python:public-api | terminal | 608 / 927 | 21 | N/A |
| inkeep/visimer | node:public-api | parse | 505 / 957 | 17 | N/A |
| kingsword09/mermansi | cli:end-to-end | terminal | 738 / 927 | 23 | N/A |
| kitlangton/merman | bun:public-api | terminal | 113 / 927 | 3 | N/A |
| Latias94/merman | node:public-api | png | 0 / 927 | 0 | N/A |
| lukilabs/beautiful-mermaid | node:public-api | terminal | 211 / 927 | 6 | N/A |
| Mootikins/figurehead-rs | cli:end-to-end | terminal | 218 / 927 | 4 | N/A |
| neongreen/mermaid-ast | node:public-api | parse | 662 / 957 | 18 | N/A |
| probelabs/maid | node:public-api | diagnostics | 463 / 957 | 5 | 212 / 463 |
| tariqshams/mermaidtui | node:public-api | terminal | 41 / 927 | 11 | N/A |
| xai-org/grok-build | cli:end-to-end | terminal | 352 / 927 | 5 | N/A |
| Yassimba/loom | bun:published-renderer-component | terminal | 457 / 927 | 10 | N/A |
| 4nkitd/opencode-merman | bun:opentui-headless-integration | terminal | 351 / 927 | 19 | N/A |
| kais-radwan/ascii-mermaid | node:public-api | terminal | 299 / 927 | 8 | N/A |
| mopi1402/termaid-ts | node:public-api | terminal | 599 / 927 | 18 | N/A |
| npm:tui-mermaid | node:public-api | terminal | 347 / 927 | 5 | N/A |
| spacedock-dev/mermaidtext | cli:end-to-end | terminal | 352 / 927 | 5 | N/A |
| xl0/lovely-mermaid | node:public-api | terminal | 439 / 927 | 9 | N/A |
| mermaid-js/mermaid | node:public-parse-validation | parse | 948 / 957 | 23 | N/A |
| fdotu/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| gmh5225/beautiful-mermaid | node:public-api | terminal | 237 / 927 | 5 | N/A |
| HealthSamurai/beautiful-mermaid | node:public-api | terminal | 211 / 927 | 6 | N/A |
| Stars1233/beautiful-mermaid | node:public-api | terminal | 211 / 927 | 6 | N/A |
| Aurelian-Shuttleworth/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| catdevman/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| dydoc/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| jeis4wpi/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| leonj1/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| sgryjp/mermaid-ascii | cli:end-to-end | terminal | 91 / 927 | 2 | N/A |
| emtyty/merslim | browser:react-component | png | 653 / 927 | 14 | N/A |
| Dicklesworthstone/frankenmermaid | node:public-api | svg | 816 / 927 | 23 | N/A |
| wevm/ondine | node:public-api | svg | 866 / 927 | 23 | N/A |
| orestesgaolin/mermaid | node:public-api | svg | 791 / 927 | 23 | N/A |
| akashacms/mermaid-wasm-renderer | node:public-api | svg | 654 / 927 | 23 | N/A |
| woxQAQ/mermaid-rs-render-js | node:public-api | svg | 675 / 927 | 23 | N/A |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | svg | 249 / 927 | 5 | N/A |
| 2233admin/beautiful-mermaid | node:public-api | svg | 241 / 927 | 6 | N/A |
| adewale/agentic-mermaid | node:public-api | svg | 901 / 927 | 23 | N/A |
| dfadler/zombie-mermaid | node:public-api | svg | 482 / 927 | 9 | N/A |
| ktrysmt/beautiful-mermaid | node:public-api | svg | 243 / 927 | 6 | N/A |
| rohitg00/beautiful-mermaid | node:public-api | svg | 249 / 927 | 5 | N/A |
| theletterf/beautiful-mermaid | node:public-api | svg | 253 / 927 | 5 | N/A |
| thepanax/beautiful-mermaid | node:public-api | svg | 241 / 927 | 6 | N/A |
| toeverything/mermaid-rs-renderer | node:public-api | svg | 684 / 927 | 23 | N/A |
| vercel-labs/beautiful-mermaid | node:public-api | svg | 249 / 927 | 5 | N/A |
| ysknsid25/beautiful-mermaid | bun:public-api | svg | 223 / 927 | 5 | N/A |
| zhenhuaa/mdv | node:public-api | svg | 241 / 927 | 6 | N/A |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | svg | 699 / 927 | 23 | N/A |
| crafter-station/mermaid | node:public-api | svg | 0 / 927 | 0 | N/A |
| emtyty/merslim | node:public-api | svg | 182 / 927 | 11 | N/A |
| evangwt/xmermaid | node:public-api | svg | 0 / 927 | 0 | N/A |
| KlangHaus/vitepress-plugin-diagram | node:public-api | svg | 169 / 927 | 3 | N/A |
| Latias94/merman | node:public-api | svg | 899 / 927 | 23 | N/A |
| lukilabs/beautiful-mermaid | node:public-api | svg | 241 / 927 | 6 | N/A |
| obsidianmd/pele | node:public-api | svg | 872 / 927 | 23 | N/A |
| sandyyst/dsh-plugin-mermaid-gb-svg | node:public-api | svg | 181 / 927 | 15 | N/A |
| taoche/mermaid-reactflow-render | node:public-api | react-flow | 166 / 927 | 13 | N/A |
| crabtalk/bezel | node:public-api | svg | 872 / 927 | 23 | N/A |
| fdotu/beautiful-mermaid | node:public-api | svg | 249 / 927 | 5 | N/A |
| gmh5225/beautiful-mermaid | node:public-api | svg | 249 / 927 | 5 | N/A |
| HealthSamurai/beautiful-mermaid | node:public-api | svg | 241 / 927 | 6 | N/A |
| Stars1233/beautiful-mermaid | node:public-api | svg | 241 / 927 | 6 | N/A |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | 816 / 927 | 23 | N/A |
| wevm/ondine | browser:public-api | svg | 866 / 927 | 23 | N/A |
| orestesgaolin/mermaid | browser:public-api | svg | 791 / 927 | 23 | N/A |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | 249 / 927 | 5 | N/A |
| 2233admin/beautiful-mermaid | browser:public-api | svg | 241 / 927 | 6 | N/A |
| adewale/agentic-mermaid | browser:public-api | svg | 901 / 927 | 23 | N/A |
| blackst0ne/mermaid | browser:public-api | svg | 0 / 927 | 0 | N/A |
| dfadler/zombie-mermaid | browser:public-api | svg | 482 / 927 | 9 | N/A |
| enrimr/mermaid | browser:public-api | svg | 254 / 927 | 5 | N/A |
| fdotu/beautiful-mermaid | browser:public-api | svg | 249 / 927 | 5 | N/A |
| gmh5225/beautiful-mermaid | browser:public-api | svg | 249 / 927 | 5 | N/A |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | 241 / 927 | 6 | N/A |
| ioggstream/d3fend-mermaid | browser:public-api | svg | 664 / 927 | 22 | N/A |
| jacob-lcs/mermaid | browser:public-api | svg | 657 / 927 | 22 | N/A |
| jgraph/mermaid | browser:public-api | svg | 316 / 927 | 14 | N/A |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | 243 / 927 | 6 | N/A |
| lishid/mermaid | browser:public-api | svg | 413 / 927 | 9 | N/A |
| lyngai/mermaid | browser:public-api | svg | 290 / 927 | 6 | N/A |
| mbostock/mermaid | browser:public-api | svg | 428 / 927 | 10 | N/A |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | 248 / 927 | 14 | N/A |
| NicolasNewman/mermaid | browser:public-api | svg | 534 / 927 | 19 | N/A |
| rohitg00/beautiful-mermaid | browser:public-api | svg | 249 / 927 | 5 | N/A |
| songshaodong/mermaid | browser:public-api | svg | 200 / 927 | 3 | N/A |
| Stars1233/beautiful-mermaid | browser:public-api | svg | 241 / 927 | 6 | N/A |
| theletterf/beautiful-mermaid | browser:public-api | svg | 253 / 927 | 5 | N/A |
| thepanax/beautiful-mermaid | browser:public-api | svg | 241 / 927 | 6 | N/A |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | 684 / 927 | 23 | N/A |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | 249 / 927 | 5 | N/A |
| xen3r0/mermaid | browser:public-api | svg | 216 / 927 | 4 | N/A |
| xeolabs/mermaid | browser:public-api | svg | 398 / 927 | 13 | N/A |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | 223 / 927 | 5 | N/A |
| zakaria-forks/mermaid | browser:public-api | svg | 260 / 927 | 15 | N/A |
| zhenhuaa/mdv | browser:public-api | svg | 241 / 927 | 6 | N/A |
| crafter-station/mermaid | browser:public-api | svg | 0 / 927 | 0 | N/A |
| emtyty/merslim | browser:react-component | svg | 352 / 927 | 14 | N/A |
| evangwt/xmermaid | browser:public-api | svg | 487 / 927 | 19 | N/A |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | 169 / 927 | 3 | N/A |
| Latias94/merman | browser:public-api | svg | 899 / 927 | 23 | N/A |
| lukilabs/beautiful-mermaid | browser:public-api | svg | 241 / 927 | 6 | N/A |
| obsidianmd/pele | browser:public-api | svg | 872 / 927 | 23 | N/A |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | 181 / 927 | 15 | N/A |
| mermaid-js/mermaid | browser:public-api | svg | 849 / 927 | 23 | N/A |
| crabtalk/bezel | browser:public-api | svg | 872 / 927 | 23 | N/A |

## Delivery and scoped memory diagnostics

Community API process.resourceUsage().maxRSS peaks are excluded as uninterpretable: identical parent/fork high-water values recur across independent worker implementations. Raw values remain unchanged. The displayed endRssBytes uses actual after-loop process.memoryUsage().rss, a resident snapshot including runtime/harness; it is not peak, allocation or a leak measurement.

Each runtime, boundary, output, round, worker attempt and attempted portfolio stays separate. In the feature-once replay, round-one full963-input work is never pooled with later six-core-input work; the original repeated-feature protocol retains its actual per-round counts. Browser V8 heap excludes WASM/native/GPU memory; process RSS includes runtime, caches and qualification. Missing metrics are unmeasured, not zero; these are not equal-work efficiency or leak ranks.

| Implementation | Runtime / boundary / output | Round / attempt | Portfolio inputs / features | Metric | Value | Scope |
|---|---|---|---|---|---:|---|
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / parse | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 110.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ramtinJ95/pi-mermaid-tui | Bun 1.4.2 / bun:published-renderer-component / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 196.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3818.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 105.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 887.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / png | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 3412.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / parse | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 187.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 3 | 98 observed case rows / 98 | endRssBytes | 78.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 1868.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3801.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3620.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 105.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3826.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 98.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / terminal | 1 / 3 | 795 observed case rows / 795 | endRssBytes | 131.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| aj-archipelago/merval | Node 24.19.0 / node:public-api / diagnostics | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 72.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| anomalyco/opencode | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 318.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| chenyanchen/mermaid-formatter | Node 24.19.0 / node:public-api / source | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 73.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / parse | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 101.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 327.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| inkeep/visimer | Node 24.19.0 / node:public-api / parse | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 100.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kitlangton/merman | Bun 1.4.2 / bun:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 289.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / png | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 73.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 105.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| neongreen/mermaid-ast | Node 24.19.0 / node:public-api / parse | 1 / 3 | 17 observed case rows / 17 | endRssBytes | 82.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| probelabs/maid | Node 24.19.0 / node:public-api / diagnostics | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 159.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| tariqshams/mermaidtui | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 74.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Yassimba/loom | Bun 1.4.2 / bun:published-renderer-component / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 164.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 4nkitd/opencode-merman | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 622.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kais-radwan/ascii-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3862.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mopi1402/termaid-ts | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 427.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| npm:tui-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 142.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| xl0/lovely-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 187.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mermaid-js/mermaid | Node 24.19.0 / node:public-parse-validation / parse | 1 / 1 | 963 observed case rows / 957 | endRssBytes | 303.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mermaid-js/mermaid | Node 24.19.0 / node:public-parse-validation / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 250.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| xl0/lovely-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 93.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| npm:tui-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 83.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mopi1402/termaid-ts | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 100.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kais-radwan/ascii-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 545.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 4nkitd/opencode-merman | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 159.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Yassimba/loom | Bun 1.4.2 / bun:published-renderer-component / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 85.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| tariqshams/mermaidtui | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 56.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| probelabs/maid | Node 24.19.0 / node:public-api / diagnostics | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 155.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| neongreen/mermaid-ast | Node 24.19.0 / node:public-api / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 116.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 671.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / png | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 63.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kitlangton/merman | Bun 1.4.2 / bun:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 265.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| inkeep/visimer | Node 24.19.0 / node:public-api / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 97.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 119.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 100.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| chenyanchen/mermaid-formatter | Node 24.19.0 / node:public-api / source | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 70.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| anomalyco/opencode | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 139.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| aj-archipelago/merval | Node 24.19.0 / node:public-api / diagnostics | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 59.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 595.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 420.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 541.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 670.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 543.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 541.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 684.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 111.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 233.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / png | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 641.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 132.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 671.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 544.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ramtinJ95/pi-mermaid-tui | Bun 1.4.2 / bun:published-renderer-component / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 77.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / parse | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 110.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 101.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ramtinJ95/pi-mermaid-tui | Bun 1.4.2 / bun:published-renderer-component / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 75.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 543.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 672.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 213.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / png | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 639.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 132.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 103.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 640.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 565.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 564.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 670.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 564.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 419.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 610.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| aj-archipelago/merval | Node 24.19.0 / node:public-api / diagnostics | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 59.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| anomalyco/opencode | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 136.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| chenyanchen/mermaid-formatter | Node 24.19.0 / node:public-api / source | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 69.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 101.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 118.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| inkeep/visimer | Node 24.19.0 / node:public-api / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 97.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kitlangton/merman | Bun 1.4.2 / bun:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 273.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / png | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 64.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 670.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| neongreen/mermaid-ast | Node 24.19.0 / node:public-api / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 113.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| probelabs/maid | Node 24.19.0 / node:public-api / diagnostics | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 155.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| tariqshams/mermaidtui | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 56.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Yassimba/loom | Bun 1.4.2 / bun:published-renderer-component / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 88.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 4nkitd/opencode-merman | Bun 1.4.2 / bun:opentui-headless-integration / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 156.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| kais-radwan/ascii-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 544.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mopi1402/termaid-ts | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 100.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| npm:tui-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 83.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| xl0/lovely-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 96.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| mermaid-js/mermaid | Node 24.19.0 / node:public-parse-validation / parse | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 250.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3818.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 544.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 543.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 1 | 930 observed case rows / 927 | endRssBytes | 3818.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 544.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 543.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 105.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 671.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 672.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 1 / 2 | 795 observed case rows / 795 | endRssBytes | 105.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 2 / 1 | 3 observed case rows / 0 | endRssBytes | 671.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / terminal | 3 / 1 | 3 observed case rows / 0 | endRssBytes | 672.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | chromium-v8 / browser:react-component / png | 1 / — | 933 / 927 | jsHeapUsedBytes | 4.7 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / png:js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| emtyty/merslim | chromium-v8 / browser:react-component / png | 2 / — | 6 / 0 | jsHeapUsedBytes | 3.8 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / png:js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| emtyty/merslim | chromium-v8 / browser:react-component / png | 3 / — | 6 / 0 | jsHeapUsedBytes | 3.8 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / png:js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 167.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| wevm/ondine | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 187.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| orestesgaolin/mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 212.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| akashacms/mermaid-wasm-renderer | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 177.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| woxQAQ/mermaid-rs-render-js | Node 24.19.0 / node:public-api / svg | 1 / 3 | 799 observed case rows / 799 | endRssBytes | 116.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 307.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 339.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 489.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 321.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 338.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 303.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 316.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 338.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| toeverything/mermaid-rs-renderer | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 387.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 311.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 403.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 339.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 95.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 263.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| KlangHaus/vitepress-plugin-diagram | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 114.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 183.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 335.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| obsidianmd/pele | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 217.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| sandyyst/dsh-plugin-mermaid-gb-svg | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 169.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| taoche/mermaid-reactflow-render | Node 24.19.0 / node:public-api / react-flow | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 256.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crabtalk/bezel | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 343.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crabtalk/bezel | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 359.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| taoche/mermaid-reactflow-render | Node 24.19.0 / node:public-api / react-flow | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 166.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| sandyyst/dsh-plugin-mermaid-gb-svg | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 109.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| obsidianmd/pele | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 133.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 273.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 101.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| KlangHaus/vitepress-plugin-diagram | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 108.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 180.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 69.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 292.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 311.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 228.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| toeverything/mermaid-rs-renderer | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 360.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 272.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 232.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 237.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 271.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 269.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 307.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 280.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 246.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| woxQAQ/mermaid-rs-render-js | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 76.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| akashacms/mermaid-wasm-renderer | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 186.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| orestesgaolin/mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 135.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| wevm/ondine | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 139.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 162.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Dicklesworthstone/frankenmermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 160.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| wevm/ondine | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 134.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| orestesgaolin/mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 144.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| akashacms/mermaid-wasm-renderer | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 220.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| woxQAQ/mermaid-rs-render-js | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 76.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 01colyncelestine-stack/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 172.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| 2233admin/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 283.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| adewale/agentic-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 307.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| dfadler/zombie-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 274.5 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ktrysmt/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 291.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| rohitg00/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 226.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| theletterf/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 224.3 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| thepanax/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 293.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| toeverything/mermaid-rs-renderer | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 358.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| vercel-labs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 226.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| ysknsid25/beautiful-mermaid | Bun 1.4.2 / bun:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 309.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| zhenhuaa/mdv | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 299.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crafter-station/mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 69.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| emtyty/merslim | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 211.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| KlangHaus/vitepress-plugin-diagram | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 100.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Latias94/merman | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 102.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| lukilabs/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 272.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| obsidianmd/pele | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 126.7 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| sandyyst/dsh-plugin-mermaid-gb-svg | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 93.9 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| taoche/mermaid-reactflow-render | Node 24.19.0 / node:public-api / react-flow | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 168.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| crabtalk/bezel | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 359.8 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 307.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 246.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| fdotu/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 172.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 307.1 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 246.6 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| gmh5225/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 172.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 339.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 280.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| HealthSamurai/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 283.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 1 / 1 | 933 observed case rows / 927 | endRssBytes | 339.0 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 2 / 1 | 6 observed case rows / 0 | endRssBytes | 280.4 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Stars1233/beautiful-mermaid | Node 24.19.0 / node:public-api / svg | 3 / 1 | 6 observed case rows / 0 | endRssBytes | 283.2 MiB | after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included |
| Dicklesworthstone/frankenmermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 1.8 MiB | forced-GC browser V8 heap |
| Dicklesworthstone/frankenmermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 787.4 KiB | through attempted portfolio; 2 requests |
| wevm/ondine | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 1.6 MiB | forced-GC browser V8 heap |
| wevm/ondine | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 620.6 KiB | through attempted portfolio; 2 requests |
| orestesgaolin/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| orestesgaolin/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 804.6 KiB | through attempted portfolio; 1 requests |
| 01colyncelestine-stack/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| 01colyncelestine-stack/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| 2233admin/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| 2233admin/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| adewale/agentic-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 32.9 MiB | forced-GC browser V8 heap |
| adewale/agentic-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 1149.9 KiB | through attempted portfolio; 1 requests |
| dfadler/zombie-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 13.7 MiB | forced-GC browser V8 heap |
| dfadler/zombie-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 603.6 KiB | through attempted portfolio; 1 requests |
| enrimr/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 5.8 MiB | forced-GC browser V8 heap |
| enrimr/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 218.3 KiB | through attempted portfolio; 1 requests |
| fdotu/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| fdotu/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| gmh5225/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| gmh5225/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| HealthSamurai/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| HealthSamurai/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| jgraph/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 19.5 MiB | forced-GC browser V8 heap |
| jgraph/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 822.0 KiB | through attempted portfolio; 1 requests |
| ktrysmt/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.9 MiB | forced-GC browser V8 heap |
| ktrysmt/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 485.8 KiB | through attempted portfolio; 1 requests |
| lishid/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 7.5 MiB | forced-GC browser V8 heap |
| lishid/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 235.1 KiB | through attempted portfolio; 1 requests |
| lyngai/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 6.7 MiB | forced-GC browser V8 heap |
| lyngai/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 338.6 KiB | through attempted portfolio; 1 requests |
| mbostock/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 8.3 MiB | forced-GC browser V8 heap |
| mbostock/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 276.6 KiB | through attempted portfolio; 1 requests |
| rohitg00/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| rohitg00/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| songshaodong/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 4.7 MiB | forced-GC browser V8 heap |
| songshaodong/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 166.2 KiB | through attempted portfolio; 1 requests |
| Stars1233/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| Stars1233/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| theletterf/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| theletterf/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 42.4 KiB | through attempted portfolio; 1 requests |
| thepanax/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| thepanax/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| toeverything/mermaid-rs-renderer | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 1.6 MiB | forced-GC browser V8 heap |
| toeverything/mermaid-rs-renderer | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 967.5 KiB | through attempted portfolio; 2 requests |
| vercel-labs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.9 MiB | forced-GC browser V8 heap |
| vercel-labs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 45.1 KiB | through attempted portfolio; 1 requests |
| xen3r0/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 6.0 MiB | forced-GC browser V8 heap |
| xen3r0/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 330.4 KiB | through attempted portfolio; 1 requests |
| ysknsid25/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.4 MiB | forced-GC browser V8 heap |
| ysknsid25/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 483.1 KiB | through attempted portfolio; 1 requests |
| zhenhuaa/mdv | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| zhenhuaa/mdv | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 459.1 KiB | through attempted portfolio; 1 requests |
| crafter-station/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.5 MiB | forced-GC browser V8 heap |
| crafter-station/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 20.2 KiB | through attempted portfolio; 1 requests |
| emtyty/merslim | chromium-v8 / browser:react-component / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 4.7 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| evangwt/xmermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 3.0 MiB | forced-GC browser V8 heap |
| evangwt/xmermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 617.1 KiB | through attempted portfolio; 2 requests |
| KlangHaus/vitepress-plugin-diagram | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.2 MiB | forced-GC browser V8 heap |
| KlangHaus/vitepress-plugin-diagram | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 12.6 KiB | through attempted portfolio; 1 requests |
| Latias94/merman | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| Latias94/merman | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 4957.2 KiB | through attempted portfolio; 18 requests |
| lukilabs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 11.6 MiB | forced-GC browser V8 heap |
| lukilabs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| obsidianmd/pele | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 7.9 MiB | forced-GC browser V8 heap |
| obsidianmd/pele | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 257.1 KiB | through attempted portfolio; 1 requests |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 1.9 MiB | forced-GC browser V8 heap |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 10.2 KiB | through attempted portfolio; 1 requests |
| mermaid-js/mermaid | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 32.3 MiB | forced-GC browser V8 heap |
| mermaid-js/mermaid | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 1534.1 KiB | through attempted portfolio; 1 requests |
| crabtalk/bezel | chromium-v8 / browser:public-api / svg | 1 / — | 933 / 927 | jsHeapUsedBytes | 1.7 MiB | forced-GC browser V8 heap |
| crabtalk/bezel | chromium / browser:public-api / js-wasm-fonts | 1 / — | 933 / 927 | gzipBytes | 2011.8 KiB | through attempted portfolio; 1 requests |
| crabtalk/bezel | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| crabtalk/bezel | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 2011.8 KiB | through attempted portfolio; 1 requests |
| mermaid-js/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 19.1 MiB | forced-GC browser V8 heap |
| mermaid-js/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 1534.1 KiB | through attempted portfolio; 1 requests |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 1.8 MiB | forced-GC browser V8 heap |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 10.2 KiB | through attempted portfolio; 1 requests |
| obsidianmd/pele | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 4.6 MiB | forced-GC browser V8 heap |
| obsidianmd/pele | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 257.1 KiB | through attempted portfolio; 1 requests |
| lukilabs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.1 MiB | forced-GC browser V8 heap |
| lukilabs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| Latias94/merman | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.4 MiB | forced-GC browser V8 heap |
| Latias94/merman | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 4957.2 KiB | through attempted portfolio; 18 requests |
| KlangHaus/vitepress-plugin-diagram | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.3 MiB | forced-GC browser V8 heap |
| KlangHaus/vitepress-plugin-diagram | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 12.6 KiB | through attempted portfolio; 1 requests |
| evangwt/xmermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.5 MiB | forced-GC browser V8 heap |
| evangwt/xmermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 617.1 KiB | through attempted portfolio; 2 requests |
| emtyty/merslim | chromium-v8 / browser:react-component / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 3.8 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| crafter-station/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.1 MiB | forced-GC browser V8 heap |
| crafter-station/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 20.2 KiB | through attempted portfolio; 1 requests |
| zhenhuaa/mdv | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| zhenhuaa/mdv | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 459.1 KiB | through attempted portfolio; 1 requests |
| zakaria-forks/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 6.2 MiB | forced-GC browser V8 heap |
| zakaria-forks/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 663.5 KiB | through attempted portfolio; 1 requests |
| ysknsid25/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.1 MiB | forced-GC browser V8 heap |
| ysknsid25/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 483.1 KiB | through attempted portfolio; 1 requests |
| xeolabs/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 5.6 MiB | forced-GC browser V8 heap |
| xeolabs/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 844.5 KiB | through attempted portfolio; 1 requests |
| xen3r0/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 4.8 MiB | forced-GC browser V8 heap |
| xen3r0/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 330.4 KiB | through attempted portfolio; 1 requests |
| vercel-labs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| vercel-labs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 45.1 KiB | through attempted portfolio; 1 requests |
| toeverything/mermaid-rs-renderer | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| toeverything/mermaid-rs-renderer | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 967.5 KiB | through attempted portfolio; 2 requests |
| thepanax/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.3 MiB | forced-GC browser V8 heap |
| thepanax/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| theletterf/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| theletterf/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 42.4 KiB | through attempted portfolio; 1 requests |
| Stars1233/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| Stars1233/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| songshaodong/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 3.6 MiB | forced-GC browser V8 heap |
| songshaodong/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 166.2 KiB | through attempted portfolio; 1 requests |
| rohitg00/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| rohitg00/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| NicolasNewman/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 7.4 MiB | forced-GC browser V8 heap |
| NicolasNewman/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 749.2 KiB | through attempted portfolio; 1 requests |
| Mermaid-Chart/mermaid-develop | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 9.9 MiB | forced-GC browser V8 heap |
| Mermaid-Chart/mermaid-develop | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 871.2 KiB | through attempted portfolio; 1 requests |
| mbostock/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 6.2 MiB | forced-GC browser V8 heap |
| mbostock/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 276.6 KiB | through attempted portfolio; 1 requests |
| lyngai/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 5.2 MiB | forced-GC browser V8 heap |
| lyngai/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 338.6 KiB | through attempted portfolio; 1 requests |
| lishid/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 5.6 MiB | forced-GC browser V8 heap |
| lishid/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 235.1 KiB | through attempted portfolio; 1 requests |
| ktrysmt/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.6 MiB | forced-GC browser V8 heap |
| ktrysmt/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 485.8 KiB | through attempted portfolio; 1 requests |
| jgraph/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 6.9 MiB | forced-GC browser V8 heap |
| jgraph/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 822.0 KiB | through attempted portfolio; 1 requests |
| jacob-lcs/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 7.7 MiB | forced-GC browser V8 heap |
| jacob-lcs/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 770.0 KiB | through attempted portfolio; 1 requests |
| ioggstream/d3fend-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 7.7 MiB | forced-GC browser V8 heap |
| ioggstream/d3fend-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 775.1 KiB | through attempted portfolio; 1 requests |
| HealthSamurai/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| HealthSamurai/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| gmh5225/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| gmh5225/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| fdotu/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.7 MiB | forced-GC browser V8 heap |
| fdotu/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| enrimr/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 4.5 MiB | forced-GC browser V8 heap |
| enrimr/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 218.3 KiB | through attempted portfolio; 1 requests |
| dfadler/zombie-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.4 MiB | forced-GC browser V8 heap |
| dfadler/zombie-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 603.6 KiB | through attempted portfolio; 1 requests |
| adewale/agentic-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 22.1 MiB | forced-GC browser V8 heap |
| adewale/agentic-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 1149.9 KiB | through attempted portfolio; 1 requests |
| 2233admin/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| 2233admin/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| 01colyncelestine-stack/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 2.7 MiB | forced-GC browser V8 heap |
| 01colyncelestine-stack/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| orestesgaolin/mermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 7.0 MiB | forced-GC browser V8 heap |
| orestesgaolin/mermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 804.6 KiB | through attempted portfolio; 1 requests |
| wevm/ondine | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| wevm/ondine | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 620.6 KiB | through attempted portfolio; 2 requests |
| Dicklesworthstone/frankenmermaid | chromium-v8 / browser:public-api / svg | 2 / — | 6 / 0 | jsHeapUsedBytes | 1.7 MiB | forced-GC browser V8 heap |
| Dicklesworthstone/frankenmermaid | chromium / browser:public-api / js-wasm-fonts | 2 / — | 6 / 0 | gzipBytes | 787.4 KiB | through attempted portfolio; 2 requests |
| Dicklesworthstone/frankenmermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 1.7 MiB | forced-GC browser V8 heap |
| Dicklesworthstone/frankenmermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 787.4 KiB | through attempted portfolio; 2 requests |
| wevm/ondine | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| wevm/ondine | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 620.6 KiB | through attempted portfolio; 2 requests |
| orestesgaolin/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 7.3 MiB | forced-GC browser V8 heap |
| orestesgaolin/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 804.6 KiB | through attempted portfolio; 1 requests |
| 01colyncelestine-stack/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| 01colyncelestine-stack/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| 2233admin/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| 2233admin/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| adewale/agentic-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 22.0 MiB | forced-GC browser V8 heap |
| adewale/agentic-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 1149.9 KiB | through attempted portfolio; 1 requests |
| dfadler/zombie-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.3 MiB | forced-GC browser V8 heap |
| dfadler/zombie-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 603.6 KiB | through attempted portfolio; 1 requests |
| enrimr/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 4.5 MiB | forced-GC browser V8 heap |
| enrimr/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 218.3 KiB | through attempted portfolio; 1 requests |
| fdotu/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| fdotu/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| gmh5225/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| gmh5225/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| HealthSamurai/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| HealthSamurai/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| ioggstream/d3fend-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 7.8 MiB | forced-GC browser V8 heap |
| ioggstream/d3fend-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 775.1 KiB | through attempted portfolio; 1 requests |
| jacob-lcs/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 7.7 MiB | forced-GC browser V8 heap |
| jacob-lcs/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 770.0 KiB | through attempted portfolio; 1 requests |
| jgraph/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 6.9 MiB | forced-GC browser V8 heap |
| jgraph/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 822.0 KiB | through attempted portfolio; 1 requests |
| ktrysmt/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.6 MiB | forced-GC browser V8 heap |
| ktrysmt/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 485.8 KiB | through attempted portfolio; 1 requests |
| lishid/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 5.6 MiB | forced-GC browser V8 heap |
| lishid/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 235.1 KiB | through attempted portfolio; 1 requests |
| lyngai/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 5.2 MiB | forced-GC browser V8 heap |
| lyngai/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 338.6 KiB | through attempted portfolio; 1 requests |
| mbostock/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 6.2 MiB | forced-GC browser V8 heap |
| mbostock/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 276.6 KiB | through attempted portfolio; 1 requests |
| Mermaid-Chart/mermaid-develop | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 9.9 MiB | forced-GC browser V8 heap |
| Mermaid-Chart/mermaid-develop | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 871.2 KiB | through attempted portfolio; 1 requests |
| NicolasNewman/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 7.4 MiB | forced-GC browser V8 heap |
| NicolasNewman/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 749.2 KiB | through attempted portfolio; 1 requests |
| rohitg00/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| rohitg00/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 41.9 KiB | through attempted portfolio; 1 requests |
| songshaodong/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 3.6 MiB | forced-GC browser V8 heap |
| songshaodong/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 166.2 KiB | through attempted portfolio; 1 requests |
| Stars1233/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.3 MiB | forced-GC browser V8 heap |
| Stars1233/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| theletterf/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| theletterf/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 42.4 KiB | through attempted portfolio; 1 requests |
| thepanax/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.1 MiB | forced-GC browser V8 heap |
| thepanax/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| toeverything/mermaid-rs-renderer | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| toeverything/mermaid-rs-renderer | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 967.5 KiB | through attempted portfolio; 2 requests |
| vercel-labs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.8 MiB | forced-GC browser V8 heap |
| vercel-labs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 45.1 KiB | through attempted portfolio; 1 requests |
| xen3r0/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 4.8 MiB | forced-GC browser V8 heap |
| xen3r0/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 330.4 KiB | through attempted portfolio; 1 requests |
| xeolabs/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 5.6 MiB | forced-GC browser V8 heap |
| xeolabs/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 844.5 KiB | through attempted portfolio; 1 requests |
| ysknsid25/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.1 MiB | forced-GC browser V8 heap |
| ysknsid25/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 483.1 KiB | through attempted portfolio; 1 requests |
| zakaria-forks/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 6.2 MiB | forced-GC browser V8 heap |
| zakaria-forks/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 663.5 KiB | through attempted portfolio; 1 requests |
| zhenhuaa/mdv | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.2 MiB | forced-GC browser V8 heap |
| zhenhuaa/mdv | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 459.1 KiB | through attempted portfolio; 1 requests |
| crafter-station/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 1.9 MiB | forced-GC browser V8 heap |
| crafter-station/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 20.2 KiB | through attempted portfolio; 1 requests |
| emtyty/merslim | chromium-v8 / browser:react-component / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 3.8 MiB | forced-GC browser V8 heap |
| emtyty/merslim | chromium / browser:react-component / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 123.1 KiB | through attempted portfolio; 1 requests |
| evangwt/xmermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.5 MiB | forced-GC browser V8 heap |
| evangwt/xmermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 617.1 KiB | through attempted portfolio; 2 requests |
| KlangHaus/vitepress-plugin-diagram | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.3 MiB | forced-GC browser V8 heap |
| KlangHaus/vitepress-plugin-diagram | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 12.6 KiB | through attempted portfolio; 1 requests |
| Latias94/merman | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.4 MiB | forced-GC browser V8 heap |
| Latias94/merman | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 4957.2 KiB | through attempted portfolio; 18 requests |
| lukilabs/beautiful-mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 12.1 MiB | forced-GC browser V8 heap |
| lukilabs/beautiful-mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 481.4 KiB | through attempted portfolio; 1 requests |
| obsidianmd/pele | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 4.6 MiB | forced-GC browser V8 heap |
| obsidianmd/pele | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 257.1 KiB | through attempted portfolio; 1 requests |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 2.2 MiB | forced-GC browser V8 heap |
| sandyyst/dsh-plugin-mermaid-gb-svg | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 10.2 KiB | through attempted portfolio; 1 requests |
| mermaid-js/mermaid | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 19.1 MiB | forced-GC browser V8 heap |
| mermaid-js/mermaid | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 1534.1 KiB | through attempted portfolio; 1 requests |
| crabtalk/bezel | chromium-v8 / browser:public-api / svg | 3 / — | 6 / 0 | jsHeapUsedBytes | 1.5 MiB | forced-GC browser V8 heap |
| crabtalk/bezel | chromium / browser:public-api / js-wasm-fonts | 3 / — | 6 / 0 | gzipBytes | 2011.8 KiB | through attempted portfolio; 1 requests |

## Catalog operation outcomes

Counts retain actual capability and operation outcomes. Not-applicable and unsupported results are distinct from failures; acquisition/configuration is not a positive test.

| Implementation | Boundary | Output | Operation | Status | Observations |
|---|---|---|---|---|---:|
| Dicklesworthstone/frankenmermaid | catalog:capability | terminal | capability | blocked | 1 |
| Dicklesworthstone/frankenmermaid | catalog:capability | diagnostics | capability | blocked | 1 |
| Dicklesworthstone/frankenmermaid | catalog:capability | source | capability | blocked | 1 |
| wevm/ondine | catalog:capability | terminal | capability | blocked | 1 |
| orestesgaolin/mermaid | catalog:capability | png | capability | blocked | 1 |
| crafter-station/mermaid | catalog:capability | terminal | capability | blocked | 1 |
| justsml/rusty-mermaid | node:public-api | * | render | blocked | 1 |
| Latias94/merman | catalog:capability | jpeg | capability | blocked | 1 |
| Latias94/merman | catalog:capability | pdf | capability | blocked | 1 |
| Latias94/merman | catalog:capability | terminal | capability | blocked | 1 |
| Dicklesworthstone/frankenmermaid | node:public-api | parse | parse | passed | 828 |
| Dicklesworthstone/frankenmermaid | node:public-api | parse | parse | failed | 147 |
| ramtinJ95/pi-mermaid-tui | node:public-api | terminal | render | not-applicable | 30 |
| ramtinJ95/pi-mermaid-tui | bun:published-renderer-component | terminal | render | passed | 461 |
| ramtinJ95/pi-mermaid-tui | bun:published-renderer-component | terminal | render | failed | 475 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| 2233admin/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| 2233admin/beautiful-mermaid | node:public-api | terminal | render | passed | 220 |
| 2233admin/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| 2233admin/beautiful-mermaid | node:public-api | terminal | render | failed | 223 |
| adewale/agentic-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| adewale/agentic-mermaid | node:public-api | terminal | render | passed | 875 |
| adewale/agentic-mermaid | node:public-api | terminal | render | failed | 59 |
| adewale/agentic-mermaid | node:public-api | terminal | render | unsupported | 2 |
| adewale/agentic-mermaid | node:public-api | png | render | not-applicable | 30 |
| adewale/agentic-mermaid | node:public-api | png | render | passed | 915 |
| adewale/agentic-mermaid | node:public-api | png | render | failed | 28 |
| adewale/agentic-mermaid | node:public-api | png | render | unsupported | 2 |
| adewale/agentic-mermaid | node:public-api | parse | parse | passed | 884 |
| adewale/agentic-mermaid | node:public-api | parse | parse | failed | 52 |
| adewale/agentic-mermaid | node:public-api | parse | parse | unsupported | 39 |
| app-creative/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| app-creative/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| app-creative/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| CaptainCrouton89/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| CaptainCrouton89/mermaid-ascii | cli:end-to-end | terminal | render | passed | 88 |
| CaptainCrouton89/mermaid-ascii | cli:end-to-end | terminal | render | failed | 848 |
| Chronostasys/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| Chronostasys/mermaid-ascii | cli:end-to-end | terminal | render | passed | 368 |
| Chronostasys/mermaid-ascii | cli:end-to-end | terminal | render | failed | 568 |
| ColtWindy/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| ColtWindy/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| ColtWindy/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| dfadler/zombie-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| dfadler/zombie-mermaid | node:public-api | terminal | render | passed | 466 |
| dfadler/zombie-mermaid | node:public-api | terminal | render | unsupported | 338 |
| dfadler/zombie-mermaid | node:public-api | terminal | render | failed | 132 |
| drunkhacker/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| drunkhacker/mermaid-ascii | cli:end-to-end | terminal | render | passed | 91 |
| drunkhacker/mermaid-ascii | cli:end-to-end | terminal | render | failed | 845 |
| ktrysmt/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| ktrysmt/beautiful-mermaid | node:public-api | terminal | render | passed | 221 |
| ktrysmt/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| ktrysmt/beautiful-mermaid | node:public-api | terminal | render | failed | 222 |
| ktrysmt/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| ktrysmt/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| ktrysmt/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| mopi1402/termaid | node:public-api | terminal | render | not-applicable | 30 |
| mopi1402/termaid | cli:end-to-end | terminal | render | passed | 608 |
| mopi1402/termaid | cli:end-to-end | terminal | render | failed | 328 |
| Orbiter/beautiful-mermaid-py | node:public-api | terminal | render | not-applicable | 30 |
| Orbiter/beautiful-mermaid-py | cli:end-to-end | terminal | render | passed | 242 |
| Orbiter/beautiful-mermaid-py | cli:end-to-end | terminal | render | failed | 694 |
| pgavlin/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| pgavlin/mermaid-ascii | cli:end-to-end | terminal | render | passed | 368 |
| pgavlin/mermaid-ascii | cli:end-to-end | terminal | render | failed | 568 |
| rohitg00/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| rohitg00/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| rohitg00/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| rohitg00/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| theletterf/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| theletterf/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| theletterf/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| theletterf/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| thepanax/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| thepanax/beautiful-mermaid | node:public-api | terminal | render | passed | 220 |
| thepanax/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| thepanax/beautiful-mermaid | node:public-api | terminal | render | failed | 223 |
| vercel-labs/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| vercel-labs/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| vercel-labs/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| vercel-labs/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| ysknsid25/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| ysknsid25/beautiful-mermaid | bun:public-api | terminal | render | passed | 213 |
| ysknsid25/beautiful-mermaid | bun:public-api | terminal | render | unsupported | 540 |
| ysknsid25/beautiful-mermaid | bun:public-api | terminal | render | failed | 183 |
| zhenhuaa/mdv | node:public-api | terminal | render | not-applicable | 30 |
| zhenhuaa/mdv | node:public-api | terminal | render | passed | 219 |
| zhenhuaa/mdv | node:public-api | terminal | render | unsupported | 493 |
| zhenhuaa/mdv | node:public-api | terminal | render | failed | 224 |
| 1jehuang/mermaid-rs-renderer | node:public-api | png | render | not-applicable | 30 |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | png | render | passed | 940 |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | png | render | failed | 5 |
| aj-archipelago/merval | node:public-api | diagnostics | diagnostics | failed | 18 |
| aj-archipelago/merval | node:public-api | diagnostics | diagnostics | passed | 633 |
| aj-archipelago/merval | node:public-api | diagnostics | diagnostics | unsupported | 324 |
| aj-archipelago/merval | node:public-api | diagnostics | validator-negative-admission | passed | 3 |
| aj-archipelago/merval | node:public-api | diagnostics | validator-negative-admission | failed | 3 |
| AlexanderGrooff/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| AlexanderGrooff/mermaid-ascii | cli:end-to-end | terminal | render | passed | 243 |
| AlexanderGrooff/mermaid-ascii | cli:end-to-end | terminal | render | failed | 693 |
| anomalyco/opencode | node:public-api | terminal | render | not-applicable | 30 |
| anomalyco/opencode | bun:opentui-headless-integration | terminal | render | passed | 196 |
| anomalyco/opencode | bun:opentui-headless-integration | terminal | render | unsupported | 718 |
| anomalyco/opencode | bun:opentui-headless-integration | terminal | render | failed | 22 |
| chenyanchen/mermaid-formatter | node:public-api | source | format | not-applicable | 30 |
| chenyanchen/mermaid-formatter | node:public-api | source | format | passed | 945 |
| crafter-station/mermaid | node:public-api | parse | parse | passed | 268 |
| crafter-station/mermaid | node:public-api | parse | parse | failed | 707 |
| emtyty/merslim | node:public-api | png | render | not-applicable | 30 |
| emtyty/merslim | node:public-api | png | render | blocked | 945 |
| emtyty/merslim | node:public-api | terminal | render | not-applicable | 30 |
| emtyty/merslim | node:public-api | terminal | render | passed | 341 |
| emtyty/merslim | node:public-api | terminal | render | failed | 323 |
| emtyty/merslim | node:public-api | terminal | render | unsupported | 272 |
| fasouto/termaid | node:public-api | terminal | render | not-applicable | 30 |
| fasouto/termaid | python:public-api | terminal | render | passed | 617 |
| fasouto/termaid | python:public-api | terminal | render | failed | 319 |
| inkeep/visimer | node:public-api | parse | parse | passed | 523 |
| inkeep/visimer | node:public-api | parse | parse | failed | 432 |
| inkeep/visimer | node:public-api | parse | parse | unsupported | 20 |
| kingsword09/mermansi | node:public-api | terminal | render | not-applicable | 30 |
| kingsword09/mermansi | cli:end-to-end | terminal | render | passed | 741 |
| kingsword09/mermansi | cli:end-to-end | terminal | render | failed | 195 |
| kitlangton/merman | node:public-api | terminal | render | not-applicable | 30 |
| kitlangton/merman | bun:public-api | terminal | render | passed | 122 |
| kitlangton/merman | bun:public-api | terminal | render | unsupported | 801 |
| kitlangton/merman | bun:public-api | terminal | render | failed | 13 |
| Latias94/merman | node:public-api | png | render | not-applicable | 30 |
| Latias94/merman | node:public-api | png | render | unsupported | 945 |
| lukilabs/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| lukilabs/beautiful-mermaid | node:public-api | terminal | render | passed | 220 |
| lukilabs/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| lukilabs/beautiful-mermaid | node:public-api | terminal | render | failed | 223 |
| Mootikins/figurehead-rs | node:public-api | terminal | render | not-applicable | 30 |
| Mootikins/figurehead-rs | cli:end-to-end | terminal | render | passed | 224 |
| Mootikins/figurehead-rs | cli:end-to-end | terminal | render | failed | 712 |
| neongreen/mermaid-ast | node:public-api | parse | parse | passed | 680 |
| neongreen/mermaid-ast | node:public-api | parse | parse | failed | 295 |
| probelabs/maid | node:public-api | diagnostics | diagnostics | passed | 478 |
| probelabs/maid | node:public-api | diagnostics | diagnostics | unsupported | 497 |
| probelabs/maid | node:public-api | diagnostics | validator-negative-admission | passed | 6 |
| tariqshams/mermaidtui | node:public-api | terminal | render | not-applicable | 30 |
| tariqshams/mermaidtui | node:public-api | terminal | render | failed | 895 |
| tariqshams/mermaidtui | node:public-api | terminal | render | passed | 41 |
| xai-org/grok-build | node:public-api | terminal | render | not-applicable | 30 |
| xai-org/grok-build | cli:end-to-end | terminal | render | passed | 361 |
| xai-org/grok-build | cli:end-to-end | terminal | render | unsupported | 414 |
| xai-org/grok-build | cli:end-to-end | terminal | render | failed | 161 |
| Yassimba/loom | node:public-api | terminal | render | not-applicable | 30 |
| Yassimba/loom | bun:published-renderer-component | terminal | render | passed | 466 |
| Yassimba/loom | bun:published-renderer-component | terminal | render | unsupported | 367 |
| Yassimba/loom | bun:published-renderer-component | terminal | render | failed | 103 |
| 4nkitd/opencode-merman | node:public-api | terminal | render | not-applicable | 30 |
| 4nkitd/opencode-merman | bun:opentui-headless-integration | terminal | render | passed | 360 |
| 4nkitd/opencode-merman | bun:opentui-headless-integration | terminal | render | unsupported | 533 |
| 4nkitd/opencode-merman | bun:opentui-headless-integration | terminal | render | failed | 43 |
| kais-radwan/ascii-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| kais-radwan/ascii-mermaid | node:public-api | terminal | render | passed | 308 |
| kais-radwan/ascii-mermaid | node:public-api | terminal | render | unsupported | 358 |
| kais-radwan/ascii-mermaid | node:public-api | terminal | render | failed | 270 |
| mopi1402/termaid-ts | node:public-api | terminal | render | not-applicable | 30 |
| mopi1402/termaid-ts | node:public-api | terminal | render | passed | 608 |
| mopi1402/termaid-ts | node:public-api | terminal | render | failed | 253 |
| mopi1402/termaid-ts | node:public-api | terminal | render | unsupported | 75 |
| npm:tui-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| npm:tui-mermaid | node:public-api | terminal | render | passed | 356 |
| npm:tui-mermaid | node:public-api | terminal | render | unsupported | 481 |
| npm:tui-mermaid | node:public-api | terminal | render | failed | 99 |
| spacedock-dev/mermaidtext | node:public-api | terminal | render | not-applicable | 30 |
| spacedock-dev/mermaidtext | cli:end-to-end | terminal | render | passed | 361 |
| spacedock-dev/mermaidtext | cli:end-to-end | terminal | render | unsupported | 414 |
| spacedock-dev/mermaidtext | cli:end-to-end | terminal | render | failed | 161 |
| xl0/lovely-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| xl0/lovely-mermaid | node:public-api | terminal | render | passed | 448 |
| xl0/lovely-mermaid | node:public-api | terminal | render | unsupported | 385 |
| xl0/lovely-mermaid | node:public-api | terminal | render | failed | 103 |
| mermaid-js/mermaid | node:public-parse-validation | parse | parse | passed | 966 |
| mermaid-js/mermaid | node:public-parse-validation | parse | parse | failed | 7 |
| mermaid-js/mermaid | node:public-parse-validation | parse | parse | unsupported | 2 |
| mermaid-js/mermaid | node:public-parse-validation | parse | parser-negative-admission | passed | 6 |
| fdotu/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| fdotu/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| fdotu/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| fdotu/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| gmh5225/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| gmh5225/beautiful-mermaid | node:public-api | terminal | render | passed | 246 |
| gmh5225/beautiful-mermaid | node:public-api | terminal | render | unsupported | 434 |
| gmh5225/beautiful-mermaid | node:public-api | terminal | render | failed | 256 |
| HealthSamurai/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| HealthSamurai/beautiful-mermaid | node:public-api | terminal | render | passed | 220 |
| HealthSamurai/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| HealthSamurai/beautiful-mermaid | node:public-api | terminal | render | failed | 223 |
| Stars1233/beautiful-mermaid | node:public-api | terminal | render | not-applicable | 30 |
| Stars1233/beautiful-mermaid | node:public-api | terminal | render | passed | 220 |
| Stars1233/beautiful-mermaid | node:public-api | terminal | render | unsupported | 493 |
| Stars1233/beautiful-mermaid | node:public-api | terminal | render | failed | 223 |
| Aurelian-Shuttleworth/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| Aurelian-Shuttleworth/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| Aurelian-Shuttleworth/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| catdevman/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| catdevman/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| catdevman/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| dydoc/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| dydoc/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| dydoc/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| jeis4wpi/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| jeis4wpi/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| jeis4wpi/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| leonj1/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| leonj1/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| leonj1/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| sgryjp/mermaid-ascii | node:public-api | terminal | render | not-applicable | 30 |
| sgryjp/mermaid-ascii | cli:end-to-end | terminal | render | passed | 100 |
| sgryjp/mermaid-ascii | cli:end-to-end | terminal | render | failed | 836 |
| emtyty/merslim | browser:react-component | png | load-and-initialize | passed | 3 |
| emtyty/merslim | browser:react-component | png | render | passed | 671 |
| emtyty/merslim | browser:react-component | png | render | failed | 274 |
| emtyty/merslim | browser:react-component | png | memory | passed | 3 |
| emtyty/merslim | browser:react-component | png:js-wasm-fonts | delivery | passed | 3 |
| Dicklesworthstone/frankenmermaid | node:public-api | svg | render | not-applicable | 30 |
| Dicklesworthstone/frankenmermaid | node:public-api | svg | render | passed | 834 |
| Dicklesworthstone/frankenmermaid | node:public-api | svg | render | failed | 111 |
| wevm/ondine | node:public-api | svg | render | not-applicable | 30 |
| wevm/ondine | node:public-api | svg | render | passed | 884 |
| wevm/ondine | node:public-api | svg | render | failed | 60 |
| wevm/ondine | node:public-api | svg | render | unsupported | 1 |
| orestesgaolin/mermaid | node:public-api | svg | render | not-applicable | 30 |
| orestesgaolin/mermaid | node:public-api | svg | render | passed | 809 |
| orestesgaolin/mermaid | node:public-api | svg | render | failed | 134 |
| orestesgaolin/mermaid | node:public-api | svg | render | unsupported | 2 |
| akashacms/mermaid-wasm-renderer | node:public-api | svg | render | not-applicable | 30 |
| akashacms/mermaid-wasm-renderer | node:public-api | svg | render | passed | 672 |
| akashacms/mermaid-wasm-renderer | node:public-api | svg | render | failed | 268 |
| akashacms/mermaid-wasm-renderer | node:public-api | svg | render | unsupported | 5 |
| woxQAQ/mermaid-rs-render-js | node:public-api | svg | render | not-applicable | 30 |
| woxQAQ/mermaid-rs-render-js | node:public-api | svg | render | passed | 693 |
| woxQAQ/mermaid-rs-render-js | node:public-api | svg | render | failed | 247 |
| woxQAQ/mermaid-rs-render-js | node:public-api | svg | render | unsupported | 5 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | svg | render | passed | 267 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| 01colyncelestine-stack/beautiful-mermaid | node:public-api | svg | render | failed | 244 |
| 2233admin/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| 2233admin/beautiful-mermaid | node:public-api | svg | render | passed | 259 |
| 2233admin/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| 2233admin/beautiful-mermaid | node:public-api | svg | render | failed | 194 |
| adewale/agentic-mermaid | node:public-api | svg | render | not-applicable | 30 |
| adewale/agentic-mermaid | node:public-api | svg | render | passed | 919 |
| adewale/agentic-mermaid | node:public-api | svg | render | failed | 24 |
| adewale/agentic-mermaid | node:public-api | svg | render | unsupported | 2 |
| blackst0ne/mermaid | node:public-api | svg | render | not-applicable | 30 |
| blackst0ne/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| dfadler/zombie-mermaid | node:public-api | svg | render | not-applicable | 30 |
| dfadler/zombie-mermaid | node:public-api | svg | render | passed | 500 |
| dfadler/zombie-mermaid | node:public-api | svg | render | unsupported | 338 |
| dfadler/zombie-mermaid | node:public-api | svg | render | failed | 107 |
| enrimr/mermaid | node:public-api | svg | render | not-applicable | 30 |
| enrimr/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| ioggstream/d3fend-mermaid | node:public-api | svg | render | not-applicable | 30 |
| ioggstream/d3fend-mermaid | node:public-api | svg | capability | not-applicable | 1 |
| jacob-lcs/mermaid | node:public-api | svg | render | not-applicable | 30 |
| jacob-lcs/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| jgraph/mermaid | node:public-api | svg | render | not-applicable | 30 |
| jgraph/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| ktrysmt/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| ktrysmt/beautiful-mermaid | node:public-api | svg | render | passed | 261 |
| ktrysmt/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| ktrysmt/beautiful-mermaid | node:public-api | svg | render | failed | 192 |
| lishid/mermaid | node:public-api | svg | render | not-applicable | 30 |
| lishid/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| lyngai/mermaid | node:public-api | svg | render | not-applicable | 30 |
| lyngai/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| mbostock/mermaid | node:public-api | svg | render | not-applicable | 30 |
| mbostock/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| Mermaid-Chart/mermaid-develop | node:public-api | svg | render | not-applicable | 30 |
| Mermaid-Chart/mermaid-develop | node:public-api | svg | capability | not-applicable | 1 |
| NicolasNewman/mermaid | node:public-api | svg | render | not-applicable | 30 |
| NicolasNewman/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| rohitg00/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| rohitg00/beautiful-mermaid | node:public-api | svg | render | passed | 267 |
| rohitg00/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| rohitg00/beautiful-mermaid | node:public-api | svg | render | failed | 244 |
| songshaodong/mermaid | node:public-api | svg | render | not-applicable | 30 |
| songshaodong/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| theletterf/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| theletterf/beautiful-mermaid | node:public-api | svg | render | passed | 271 |
| theletterf/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| theletterf/beautiful-mermaid | node:public-api | svg | render | failed | 240 |
| thepanax/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| thepanax/beautiful-mermaid | node:public-api | svg | render | passed | 259 |
| thepanax/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| thepanax/beautiful-mermaid | node:public-api | svg | render | failed | 194 |
| toeverything/mermaid-rs-renderer | node:public-api | svg | render | not-applicable | 30 |
| toeverything/mermaid-rs-renderer | node:public-api | svg | render | passed | 702 |
| toeverything/mermaid-rs-renderer | node:public-api | svg | render | failed | 243 |
| vercel-labs/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| vercel-labs/beautiful-mermaid | node:public-api | svg | render | passed | 267 |
| vercel-labs/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| vercel-labs/beautiful-mermaid | node:public-api | svg | render | failed | 244 |
| xen3r0/mermaid | node:public-api | svg | render | not-applicable | 30 |
| xen3r0/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| xeolabs/mermaid | node:public-api | svg | render | not-applicable | 30 |
| xeolabs/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| ysknsid25/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| ysknsid25/beautiful-mermaid | bun:public-api | svg | render | passed | 241 |
| ysknsid25/beautiful-mermaid | bun:public-api | svg | render | unsupported | 540 |
| ysknsid25/beautiful-mermaid | bun:public-api | svg | render | failed | 164 |
| zakaria-forks/mermaid | node:public-api | svg | render | not-applicable | 30 |
| zakaria-forks/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| zhenhuaa/mdv | node:public-api | svg | render | not-applicable | 30 |
| zhenhuaa/mdv | node:public-api | svg | render | passed | 259 |
| zhenhuaa/mdv | node:public-api | svg | render | unsupported | 492 |
| zhenhuaa/mdv | node:public-api | svg | render | failed | 194 |
| 1jehuang/mermaid-rs-renderer | node:public-api | svg | render | not-applicable | 30 |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | svg | render | passed | 717 |
| 1jehuang/mermaid-rs-renderer | cli:end-to-end | svg | render | failed | 228 |
| crafter-station/mermaid | node:public-api | svg | render | not-applicable | 30 |
| crafter-station/mermaid | node:public-api | svg | render | failed | 945 |
| emtyty/merslim | node:public-api | svg | render | not-applicable | 30 |
| emtyty/merslim | node:public-api | svg | render | passed | 194 |
| emtyty/merslim | node:public-api | svg | render | unsupported | 489 |
| emtyty/merslim | node:public-api | svg | render | failed | 262 |
| evangwt/xmermaid | node:public-api | svg | render | not-applicable | 30 |
| evangwt/xmermaid | node:public-api | svg | render | blocked | 945 |
| KlangHaus/vitepress-plugin-diagram | node:public-api | svg | render | not-applicable | 30 |
| KlangHaus/vitepress-plugin-diagram | node:public-api | svg | render | passed | 181 |
| KlangHaus/vitepress-plugin-diagram | node:public-api | svg | render | unsupported | 583 |
| KlangHaus/vitepress-plugin-diagram | node:public-api | svg | render | failed | 181 |
| Latias94/merman | node:public-api | svg | render | not-applicable | 30 |
| Latias94/merman | node:public-api | svg | render | passed | 917 |
| Latias94/merman | node:public-api | svg | render | failed | 27 |
| Latias94/merman | node:public-api | svg | render | unsupported | 1 |
| lukilabs/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| lukilabs/beautiful-mermaid | node:public-api | svg | render | passed | 259 |
| lukilabs/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| lukilabs/beautiful-mermaid | node:public-api | svg | render | failed | 194 |
| obsidianmd/pele | node:public-api | svg | render | not-applicable | 30 |
| obsidianmd/pele | node:public-api | svg | render | passed | 890 |
| obsidianmd/pele | node:public-api | svg | render | failed | 54 |
| obsidianmd/pele | node:public-api | svg | render | unsupported | 1 |
| sandyyst/dsh-plugin-mermaid-gb-svg | node:public-api | svg | render | not-applicable | 30 |
| sandyyst/dsh-plugin-mermaid-gb-svg | node:public-api | svg | render | passed | 193 |
| sandyyst/dsh-plugin-mermaid-gb-svg | node:public-api | svg | render | failed | 752 |
| taoche/mermaid-reactflow-render | node:public-api | react-flow | convert | not-applicable | 30 |
| taoche/mermaid-reactflow-render | node:public-api | react-flow | convert | passed | 175 |
| taoche/mermaid-reactflow-render | node:public-api | react-flow | convert | failed | 770 |
| mermaid-js/mermaid | node:public-api | svg | render | not-applicable | 30 |
| mermaid-js/mermaid | node:public-api | svg | capability | not-applicable | 1 |
| crabtalk/bezel | node:public-api | svg | render | not-applicable | 30 |
| crabtalk/bezel | node:public-api | svg | render | passed | 890 |
| crabtalk/bezel | node:public-api | svg | render | failed | 54 |
| crabtalk/bezel | node:public-api | svg | render | unsupported | 1 |
| fdotu/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| fdotu/beautiful-mermaid | node:public-api | svg | render | passed | 267 |
| fdotu/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| fdotu/beautiful-mermaid | node:public-api | svg | render | failed | 244 |
| gmh5225/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| gmh5225/beautiful-mermaid | node:public-api | svg | render | passed | 267 |
| gmh5225/beautiful-mermaid | node:public-api | svg | render | unsupported | 434 |
| gmh5225/beautiful-mermaid | node:public-api | svg | render | failed | 244 |
| HealthSamurai/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| HealthSamurai/beautiful-mermaid | node:public-api | svg | render | passed | 259 |
| HealthSamurai/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| HealthSamurai/beautiful-mermaid | node:public-api | svg | render | failed | 194 |
| Stars1233/beautiful-mermaid | node:public-api | svg | render | not-applicable | 30 |
| Stars1233/beautiful-mermaid | node:public-api | svg | render | passed | 259 |
| Stars1233/beautiful-mermaid | node:public-api | svg | render | unsupported | 492 |
| Stars1233/beautiful-mermaid | node:public-api | svg | render | failed | 194 |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | render | not-applicable | 30 |
| wevm/ondine | browser:public-api | svg | render | not-applicable | 30 |
| orestesgaolin/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| adewale/agentic-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| blackst0ne/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| dfadler/zombie-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| enrimr/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| fdotu/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| jacob-lcs/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| jgraph/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| lishid/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| lyngai/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| mbostock/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | render | not-applicable | 30 |
| NicolasNewman/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| songshaodong/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| theletterf/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| thepanax/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | render | not-applicable | 30 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| xen3r0/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| xeolabs/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| zakaria-forks/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| zhenhuaa/mdv | browser:public-api | svg | render | not-applicable | 30 |
| crafter-station/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| emtyty/merslim | browser:public-api | svg | render | not-applicable | 30 |
| evangwt/xmermaid | browser:public-api | svg | render | not-applicable | 30 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | render | not-applicable | 30 |
| Latias94/merman | browser:public-api | svg | render | not-applicable | 30 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | render | not-applicable | 30 |
| obsidianmd/pele | browser:public-api | svg | render | not-applicable | 30 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | render | not-applicable | 30 |
| mermaid-js/mermaid | browser:public-api | svg | render | not-applicable | 30 |
| crabtalk/bezel | browser:public-api | svg | render | not-applicable | 30 |
| akashacms/mermaid-wasm-renderer | browser:public-api | svg | capability | not-applicable | 1 |
| ramtinJ95/pi-mermaid-tui | browser:public-api | svg | capability | not-applicable | 1 |
| woxQAQ/mermaid-rs-render-js | browser:public-api | svg | capability | not-applicable | 1 |
| app-creative/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| Aurelian-Shuttleworth/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| CaptainCrouton89/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| catdevman/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| Chronostasys/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| ColtWindy/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| drunkhacker/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| dydoc/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| jeis4wpi/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| ktrysmt/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| leonj1/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| mopi1402/termaid | browser:public-api | svg | capability | not-applicable | 1 |
| Orbiter/beautiful-mermaid-py | browser:public-api | svg | capability | not-applicable | 1 |
| pgavlin/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| sgryjp/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| 1jehuang/mermaid-rs-renderer | browser:public-api | svg | capability | not-applicable | 1 |
| aj-archipelago/merval | browser:public-api | svg | capability | not-applicable | 1 |
| AlexanderGrooff/mermaid-ascii | browser:public-api | svg | capability | not-applicable | 1 |
| anomalyco/opencode | browser:public-api | svg | capability | not-applicable | 1 |
| chenyanchen/mermaid-formatter | browser:public-api | svg | capability | not-applicable | 1 |
| fasouto/termaid | browser:public-api | svg | capability | not-applicable | 1 |
| inkeep/visimer | browser:public-api | svg | capability | not-applicable | 1 |
| justsml/rusty-mermaid | browser:public-api | svg | capability | not-applicable | 1 |
| kingsword09/mermansi | browser:public-api | svg | capability | not-applicable | 1 |
| kitlangton/merman | browser:public-api | svg | capability | not-applicable | 1 |
| Mootikins/figurehead-rs | browser:public-api | svg | capability | not-applicable | 1 |
| neongreen/mermaid-ast | browser:public-api | svg | capability | not-applicable | 1 |
| probelabs/maid | browser:public-api | svg | capability | not-applicable | 1 |
| taoche/mermaid-reactflow-render | browser:public-api | svg | capability | not-applicable | 1 |
| tariqshams/mermaidtui | browser:public-api | svg | capability | not-applicable | 1 |
| xai-org/grok-build | browser:public-api | svg | capability | not-applicable | 1 |
| Yassimba/loom | browser:public-api | svg | capability | not-applicable | 1 |
| 4nkitd/opencode-merman | browser:public-api | svg | capability | not-applicable | 1 |
| kais-radwan/ascii-mermaid | browser:public-api | svg | capability | not-applicable | 1 |
| mopi1402/termaid-ts | browser:public-api | svg | capability | not-applicable | 1 |
| npm:tui-mermaid | browser:public-api | svg | capability | not-applicable | 1 |
| spacedock-dev/mermaidtext | browser:public-api | svg | capability | not-applicable | 1 |
| xl0/lovely-mermaid | browser:public-api | svg | capability | not-applicable | 1 |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | render | passed | 834 |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | render | failed | 111 |
| Dicklesworthstone/frankenmermaid | browser:public-api | svg | memory | passed | 3 |
| Dicklesworthstone/frankenmermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| wevm/ondine | browser:public-api | svg | load-and-initialize | passed | 3 |
| wevm/ondine | browser:public-api | svg | render | passed | 884 |
| wevm/ondine | browser:public-api | svg | render | failed | 60 |
| wevm/ondine | browser:public-api | svg | render | unsupported | 1 |
| wevm/ondine | browser:public-api | svg | memory | passed | 3 |
| wevm/ondine | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| orestesgaolin/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| orestesgaolin/mermaid | browser:public-api | svg | render | passed | 809 |
| orestesgaolin/mermaid | browser:public-api | svg | render | failed | 136 |
| orestesgaolin/mermaid | browser:public-api | svg | memory | passed | 3 |
| orestesgaolin/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | render | passed | 267 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | render | failed | 244 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| 01colyncelestine-stack/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | render | passed | 259 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | render | failed | 194 |
| 2233admin/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| 2233admin/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| adewale/agentic-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| adewale/agentic-mermaid | browser:public-api | svg | render | passed | 919 |
| adewale/agentic-mermaid | browser:public-api | svg | render | failed | 25 |
| adewale/agentic-mermaid | browser:public-api | svg | render | unsupported | 1 |
| adewale/agentic-mermaid | browser:public-api | svg | memory | passed | 3 |
| adewale/agentic-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| blackst0ne/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| blackst0ne/mermaid | browser:public-api | svg | render | failed | 9 |
| blackst0ne/mermaid | browser:public-api | svg | render | passed | 3 |
| blackst0ne/mermaid | browser:public-api | svg | render | blocked | 933 |
| blackst0ne/mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 3 |
| dfadler/zombie-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| dfadler/zombie-mermaid | browser:public-api | svg | render | passed | 500 |
| dfadler/zombie-mermaid | browser:public-api | svg | render | unsupported | 334 |
| dfadler/zombie-mermaid | browser:public-api | svg | render | failed | 111 |
| dfadler/zombie-mermaid | browser:public-api | svg | memory | passed | 3 |
| dfadler/zombie-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| enrimr/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| enrimr/mermaid | browser:public-api | svg | render | failed | 685 |
| enrimr/mermaid | browser:public-api | svg | render | passed | 260 |
| enrimr/mermaid | browser:public-api | svg | memory | passed | 3 |
| enrimr/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| fdotu/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| fdotu/beautiful-mermaid | browser:public-api | svg | render | passed | 267 |
| fdotu/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| fdotu/beautiful-mermaid | browser:public-api | svg | render | failed | 244 |
| fdotu/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| fdotu/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | render | passed | 267 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | render | failed | 244 |
| gmh5225/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| gmh5225/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | render | passed | 259 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | render | failed | 194 |
| HealthSamurai/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| HealthSamurai/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | render | passed | 682 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | render | failed | 78 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | render | unsupported | 20 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | render | blocked | 165 |
| ioggstream/d3fend-mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| jacob-lcs/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| jacob-lcs/mermaid | browser:public-api | svg | render | passed | 675 |
| jacob-lcs/mermaid | browser:public-api | svg | render | failed | 85 |
| jacob-lcs/mermaid | browser:public-api | svg | render | unsupported | 20 |
| jacob-lcs/mermaid | browser:public-api | svg | render | blocked | 165 |
| jacob-lcs/mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| jgraph/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| jgraph/mermaid | browser:public-api | svg | render | failed | 628 |
| jgraph/mermaid | browser:public-api | svg | render | passed | 316 |
| jgraph/mermaid | browser:public-api | svg | render | unsupported | 1 |
| jgraph/mermaid | browser:public-api | svg | memory | passed | 3 |
| jgraph/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | render | passed | 261 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | render | failed | 192 |
| ktrysmt/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| ktrysmt/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| lishid/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| lishid/mermaid | browser:public-api | svg | render | passed | 428 |
| lishid/mermaid | browser:public-api | svg | render | failed | 517 |
| lishid/mermaid | browser:public-api | svg | memory | passed | 3 |
| lishid/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| lyngai/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| lyngai/mermaid | browser:public-api | svg | render | failed | 649 |
| lyngai/mermaid | browser:public-api | svg | render | passed | 296 |
| lyngai/mermaid | browser:public-api | svg | memory | passed | 3 |
| lyngai/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| mbostock/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| mbostock/mermaid | browser:public-api | svg | render | passed | 446 |
| mbostock/mermaid | browser:public-api | svg | render | failed | 499 |
| mbostock/mermaid | browser:public-api | svg | memory | passed | 3 |
| mbostock/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | load-and-initialize | passed | 3 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | render | failed | 320 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | render | passed | 254 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | render | unsupported | 206 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | render | blocked | 165 |
| Mermaid-Chart/mermaid-develop | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| NicolasNewman/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| NicolasNewman/mermaid | browser:public-api | svg | render | passed | 552 |
| NicolasNewman/mermaid | browser:public-api | svg | render | unsupported | 135 |
| NicolasNewman/mermaid | browser:public-api | svg | render | failed | 93 |
| NicolasNewman/mermaid | browser:public-api | svg | render | blocked | 165 |
| NicolasNewman/mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | render | passed | 267 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | render | failed | 244 |
| rohitg00/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| rohitg00/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| songshaodong/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| songshaodong/mermaid | browser:public-api | svg | render | failed | 742 |
| songshaodong/mermaid | browser:public-api | svg | render | passed | 203 |
| songshaodong/mermaid | browser:public-api | svg | memory | passed | 3 |
| songshaodong/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | render | passed | 259 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | render | failed | 194 |
| Stars1233/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| Stars1233/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| theletterf/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| theletterf/beautiful-mermaid | browser:public-api | svg | render | passed | 271 |
| theletterf/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| theletterf/beautiful-mermaid | browser:public-api | svg | render | failed | 240 |
| theletterf/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| theletterf/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| thepanax/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| thepanax/beautiful-mermaid | browser:public-api | svg | render | passed | 259 |
| thepanax/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| thepanax/beautiful-mermaid | browser:public-api | svg | render | failed | 194 |
| thepanax/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| thepanax/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | load-and-initialize | passed | 3 |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | render | passed | 702 |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | render | failed | 243 |
| toeverything/mermaid-rs-renderer | browser:public-api | svg | memory | passed | 3 |
| toeverything/mermaid-rs-renderer | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | render | passed | 267 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | render | unsupported | 434 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | render | failed | 244 |
| vercel-labs/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| vercel-labs/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| xen3r0/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| xen3r0/mermaid | browser:public-api | svg | render | failed | 726 |
| xen3r0/mermaid | browser:public-api | svg | render | passed | 219 |
| xen3r0/mermaid | browser:public-api | svg | memory | passed | 3 |
| xen3r0/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| xeolabs/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| xeolabs/mermaid | browser:public-api | svg | render | passed | 416 |
| xeolabs/mermaid | browser:public-api | svg | render | failed | 361 |
| xeolabs/mermaid | browser:public-api | svg | render | unsupported | 3 |
| xeolabs/mermaid | browser:public-api | svg | render | blocked | 165 |
| xeolabs/mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | render | passed | 241 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | render | unsupported | 540 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | render | failed | 164 |
| ysknsid25/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| ysknsid25/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| zakaria-forks/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| zakaria-forks/mermaid | browser:public-api | svg | render | failed | 313 |
| zakaria-forks/mermaid | browser:public-api | svg | render | passed | 266 |
| zakaria-forks/mermaid | browser:public-api | svg | render | unsupported | 201 |
| zakaria-forks/mermaid | browser:public-api | svg | render | blocked | 165 |
| zakaria-forks/mermaid | browser:public-api | js-wasm-fonts | delivery | blocked | 1 |
| zhenhuaa/mdv | browser:public-api | svg | load-and-initialize | passed | 3 |
| zhenhuaa/mdv | browser:public-api | svg | render | passed | 259 |
| zhenhuaa/mdv | browser:public-api | svg | render | unsupported | 492 |
| zhenhuaa/mdv | browser:public-api | svg | render | failed | 194 |
| zhenhuaa/mdv | browser:public-api | svg | memory | passed | 3 |
| zhenhuaa/mdv | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| crafter-station/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| crafter-station/mermaid | browser:public-api | svg | render | failed | 945 |
| crafter-station/mermaid | browser:public-api | svg | memory | passed | 3 |
| crafter-station/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| emtyty/merslim | browser:react-component | svg | load-and-initialize | passed | 3 |
| emtyty/merslim | browser:react-component | svg | render | passed | 370 |
| emtyty/merslim | browser:react-component | svg | render | failed | 575 |
| emtyty/merslim | browser:react-component | svg | memory | passed | 3 |
| emtyty/merslim | browser:react-component | js-wasm-fonts | delivery | passed | 3 |
| evangwt/xmermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| evangwt/xmermaid | browser:public-api | svg | render | passed | 502 |
| evangwt/xmermaid | browser:public-api | svg | render | failed | 443 |
| evangwt/xmermaid | browser:public-api | svg | memory | passed | 3 |
| evangwt/xmermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | load-and-initialize | passed | 3 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | render | passed | 181 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | render | unsupported | 583 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | render | failed | 181 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | svg | memory | passed | 3 |
| KlangHaus/vitepress-plugin-diagram | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| Latias94/merman | browser:public-api | svg | load-and-initialize | passed | 3 |
| Latias94/merman | browser:public-api | svg | render | passed | 917 |
| Latias94/merman | browser:public-api | svg | render | failed | 28 |
| Latias94/merman | browser:public-api | svg | memory | passed | 3 |
| Latias94/merman | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | render | passed | 259 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | render | unsupported | 492 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | render | failed | 194 |
| lukilabs/beautiful-mermaid | browser:public-api | svg | memory | passed | 3 |
| lukilabs/beautiful-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| obsidianmd/pele | browser:public-api | svg | load-and-initialize | passed | 3 |
| obsidianmd/pele | browser:public-api | svg | render | passed | 890 |
| obsidianmd/pele | browser:public-api | svg | render | failed | 54 |
| obsidianmd/pele | browser:public-api | svg | render | unsupported | 1 |
| obsidianmd/pele | browser:public-api | svg | memory | passed | 3 |
| obsidianmd/pele | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | load-and-initialize | passed | 3 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | render | passed | 193 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | render | failed | 752 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | svg | memory | passed | 3 |
| sandyyst/dsh-plugin-mermaid-gb-svg | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| mermaid-js/mermaid | browser:public-api | svg | load-and-initialize | passed | 3 |
| mermaid-js/mermaid | browser:public-api | svg | render | passed | 867 |
| mermaid-js/mermaid | browser:public-api | svg | render | failed | 77 |
| mermaid-js/mermaid | browser:public-api | svg | render | unsupported | 1 |
| mermaid-js/mermaid | browser:public-api | svg | memory | passed | 3 |
| mermaid-js/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| crabtalk/bezel | browser:public-api | svg | load-and-initialize | passed | 3 |
| crabtalk/bezel | browser:public-api | svg | render | passed | 890 |
| crabtalk/bezel | browser:public-api | svg | render | failed | 54 |
| crabtalk/bezel | browser:public-api | svg | render | unsupported | 1 |
| crabtalk/bezel | browser:public-api | svg | memory | passed | 3 |
| crabtalk/bezel | browser:public-api | js-wasm-fonts | delivery | passed | 3 |
| zakaria-forks/mermaid | browser:public-api | svg | memory | passed | 2 |
| zakaria-forks/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 2 |
| xeolabs/mermaid | browser:public-api | svg | memory | passed | 2 |
| xeolabs/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 2 |
| NicolasNewman/mermaid | browser:public-api | svg | memory | passed | 2 |
| NicolasNewman/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 2 |
| Mermaid-Chart/mermaid-develop | browser:public-api | svg | memory | passed | 2 |
| Mermaid-Chart/mermaid-develop | browser:public-api | js-wasm-fonts | delivery | passed | 2 |
| jacob-lcs/mermaid | browser:public-api | svg | memory | passed | 2 |
| jacob-lcs/mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 2 |
| ioggstream/d3fend-mermaid | browser:public-api | svg | memory | passed | 2 |
| ioggstream/d3fend-mermaid | browser:public-api | js-wasm-fonts | delivery | passed | 2 |

## Fixed-work CLI child resources

One separately instrumented GNU-time pass follows all uninstrumented CLI latency rounds. Peak RSS is the maximum per-case child value; CPU sums fresh-process cases. These values include runtime/shared code and are not PSS, allocation or leak measurements. CPU fields have 10 ms reporting grain; the conservative allowance is not a confidence interval.

| Implementation | Output | Required cases | Peak child RSS, MiB | Reported user + system CPU, ms | Conservative CPU interval, ms |
|---|---|---:|---:|---:|---:|
| app-creative/mermaid-ascii | terminal | 3 | 167.5 | 540 | 480–600 |
| Aurelian-Shuttleworth/mermaid-ascii | terminal | 3 | 167.2 | 540 | 480–600 |
| CaptainCrouton89/mermaid-ascii | terminal | 3 | 131.2 | 440 | 380–500 |
| catdevman/mermaid-ascii | terminal | 3 | 166.8 | 550 | 490–610 |
| Chronostasys/mermaid-ascii | terminal | 3 | 132.4 | 340 | 280–400 |
| ColtWindy/mermaid-ascii | terminal | 3 | 167.6 | 560 | 500–620 |
| drunkhacker/mermaid-ascii | terminal | 3 | N/A | N/A | N/A |
| dydoc/mermaid-ascii | terminal | 3 | 167.6 | 500 | 440–560 |
| jeis4wpi/mermaid-ascii | terminal | 3 | 161.3 | 610 | 550–670 |
| ktrysmt/mermaid-ascii | terminal | 3 | 167.5 | 490 | 430–550 |
| leonj1/mermaid-ascii | terminal | 3 | 167.1 | 510 | 450–570 |
| mopi1402/termaid | terminal | 3 | 58.3 | 650 | 590–710 |
| Orbiter/beautiful-mermaid-py | terminal | 3 | 67.6 | 1440 | 1380–1500 |
| pgavlin/mermaid-ascii | terminal | 3 | 132.1 | 330 | 270–390 |
| sgryjp/mermaid-ascii | terminal | 3 | 167.7 | 470 | 410–530 |
| 1jehuang/mermaid-rs-renderer | svg | 6 | 8.3 | 520 | 400–640 |
| AlexanderGrooff/mermaid-ascii | terminal | 3 | 132.1 | 410 | 350–470 |
| kingsword09/mermansi | terminal | 3 | N/A | N/A | N/A |
| Mootikins/figurehead-rs | terminal | 3 | N/A | N/A | N/A |
| xai-org/grok-build | terminal | 3 | 2.7 | < 60 (censored) | 0–60 |
| spacedock-dev/mermaidtext | terminal | 3 | 3.0 | < 60 (censored) | 0–60 |
| adewale/agentic-mermaid#node-cli | svg | 6 | 140.4 | 4200 | 4080–4320 |
| adewale/agentic-mermaid#node-cli | terminal | 3 | 111.6 | 1710 | 1650–1770 |
| adewale/agentic-mermaid#native-cli | svg | 6 | 222.7 | 5580 | 5460–5700 |
| adewale/agentic-mermaid#native-cli | terminal | 3 | 153.4 | 1910 | 1850–1970 |

### CLI executable file scopes

Executable bytes are delivery identities, not equal-work memory or complete tool package sizes. Python and other interpreted programs use external runtimes; their interpreter bytes are not a compiled tool payload. Original recorded scope remains in raw evidence. Dynamic libraries, source/dependency download closures and complete installation sizes are unmeasured here.

| Implementation | Variant | Executable file, MiB | Scope |
|---|---|---:|---|
| app-creative/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| Aurelian-Shuttleworth/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| CaptainCrouton89/mermaid-ascii | public-cli | 19.32 | Compiled executable only; external libraries/resources excluded |
| catdevman/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| Chronostasys/mermaid-ascii | public-cli | 20.24 | Compiled executable only; external libraries/resources excluded |
| ColtWindy/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| drunkhacker/mermaid-ascii | public-cli | 19.29 | Compiled executable only; external libraries/resources excluded |
| dydoc/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| jeis4wpi/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| ktrysmt/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| leonj1/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| mopi1402/termaid | public-cli | 12.43 | Compiled executable only; external libraries/resources excluded |
| Orbiter/beautiful-mermaid-py | public-cli | 29.46 | External interpreter executable; not compiled tool payload |
| pgavlin/mermaid-ascii | public-cli | 20.23 | Compiled executable only; external libraries/resources excluded |
| sgryjp/mermaid-ascii | public-cli | 19.26 | Compiled executable only; external libraries/resources excluded |
| 1jehuang/mermaid-rs-renderer | public-cli | 8.82 | Compiled executable only; external libraries/resources excluded |
| AlexanderGrooff/mermaid-ascii | public-cli | 19.56 | Compiled executable only; external libraries/resources excluded |
| kingsword09/mermansi | public-cli | 8.87 | Compiled executable only; external libraries/resources excluded |
| Mootikins/figurehead-rs | public-cli | 3.74 | Compiled executable only; external libraries/resources excluded |
| xai-org/grok-build | public-cli | 2.96 | Compiled executable only; external libraries/resources excluded |
| spacedock-dev/mermaidtext | public-cli | 2.89 | Compiled executable only; external libraries/resources excluded |
| adewale/agentic-mermaid#node-cli | node-cli | 120.15 | External Node executable; not npm delivery |
| adewale/agentic-mermaid#native-cli | native-cli | 97.81 | Compiled executable only; external libraries/resources excluded |

## Pinned Mermaid same-case score

Reviewed positive eligibility: **580 / 586 retained source inputs** enter this score; **6 diagnostic-only inputs** still executed and retain replies/clocks in the companion raw and diagnostic artifacts. Eligibility was authored before engine outcomes. Original reference status remains failed; this is a baseline protocol repair.

| Parser | Portable criteria passed / evaluated per round | All-attempt parse portfolio, ms | Shared-qualified parse portfolio, ms |
|---|---:|---:|---:|
| agentic | 2479 / 2607 (each of 3 rounds) | 115.88 | 106.72 |
| mermaid | 2607 / 2607 (each of 3 rounds) | 2751.80 | 2372.07 |

512 identical cases qualified for every engine in every round. All-attempt cost includes failures and must be read alongside scores; shared-qualified cost uses only that fixed common cohort. These public-parser clocks exclude projections and IPC. Historical layout counts are not parser quantities and are explicitly unscored here; complete imported/current grammar and native-operation tests remain separate owning suites.

## Agentic invocation outcomes

Resolved main profile **full**, 3 rounds. Only the explicitly reconciled styles partition uses scoped rerun observations; original outside-partition rows and aggregate ledger remain unchanged. Counts are observations, not exhaustive operation or language-feature coverage.

| Runtime | Boundary | Operation | Passed | Failed | Blocked | Unsupported | N/A | Skipped |
|---|---|---|---:|---:|---:|---:|---:|---:|
| node:24.19.0 | library:. | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidSVGAsync | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | factory.renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | factory.renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | persistent-working-set-pressure | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:. | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | import | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidSVGAsync | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | factory.renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | factory.renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | persistent-working-set-pressure | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:. | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidSVGAsync | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | factory.renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | factory.renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | persistent-working-set-pressure | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:. | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:svg | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:png | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | factory.renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | factory.renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:svg:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:png:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:ascii:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | renderMermaidWithActions:unicode:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | import | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:svg | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:png | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | factory.renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | factory.renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:svg:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:png:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:ascii:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | renderMermaidWithActions:unicode:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:svg | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:png | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | factory.renderMermaidPNG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | factory.renderMermaidPNGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:svg:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:png:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:ascii:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | renderMermaidWithActions:unicode:nonempty-action | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./agent/core | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | import | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./agent/core | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidSVG | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidSVGWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCII:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCII:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCIIWithReceipt:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCIIWithReceipt:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCIIWithMeta:ascii | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | renderMermaidASCIIWithMeta:unicode | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | layoutMermaidWithReceipt | 414 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | layoutMermaid | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | parseRegisteredMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | serializeMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | verifyMermaid | 69 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./agent/core | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg | renderMermaidSVG | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg | renderMermaidSVGWithReceipt | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg | import | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg | renderMermaidSVG | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg | renderMermaidSVGWithReceipt | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg | renderMermaidSVG | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg | renderMermaidSVGWithReceipt | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg | persistent-structural-session | 108 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | knownStyleDescriptors | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:crisp | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:hand-drawn | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:excalidraw | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:pen-and-ink | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:freehand | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:watercolor | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:blueprint | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:look:tufte | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:accessible-high-contrast | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:patent-drawing | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:status-dashboard | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:ops-schematic | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:chalkboard | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:risograph | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:architectural-plan | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:publication-figure | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | registered-style:look-palette-stack | 207 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | library:./svg/styles | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | import | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | knownStyleDescriptors | 3 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:crisp | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:hand-drawn | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:excalidraw | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:pen-and-ink | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:freehand | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:watercolor | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:blueprint | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:look:tufte | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:accessible-high-contrast | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:patent-drawing | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:status-dashboard | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:ops-schematic | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:chalkboard | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:risograph | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:architectural-plan | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:publication-figure | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | registered-style:look-palette-stack | 207 | 0 | 0 | 0 | 0 | 0 |
| bun:1.4.2 | library:./svg/styles | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | import | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | knownStyleDescriptors | 3 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:crisp | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:hand-drawn | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:excalidraw | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:pen-and-ink | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:freehand | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:watercolor | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:blueprint | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:look:tufte | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:accessible-high-contrast | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:patent-drawing | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:status-dashboard | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:ops-schematic | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:chalkboard | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:risograph | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:architectural-plan | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:publication-figure | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | registered-style:look-palette-stack | 207 | 0 | 0 | 0 | 0 | 0 |
| node:22.23.4 | library:./svg/styles | memory-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli-alias:am | help | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli-alias:agentic-mermaid | help | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:discovery | capabilities | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:discovery | styles | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:discovery | llms-txt | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:discovery | init-agent | 1 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | render | 115 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:file | render | 115 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | parse | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | verify | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | describe | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | format | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | preview | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | serialize | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:stdin | mutate | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:watch | render | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:batch | render-parse-verify | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | cli:markdown | render-markdown | 23 | 0 | 0 | 0 | 0 | 0 |
| bun-compiled:embedded-runtime | cli:native-binary | render | 23 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | initialize | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | tools/list | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | render_png | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | describe | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | describe_sdk | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | execute | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | mutate | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:stdio | build | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | initialize | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | tools/list | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | render_png | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | describe | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | describe_sdk | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | execute | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | mutate | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:http-sse | build | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | initialize | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | tools/list | 3 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | render_svg | 72 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | render_ascii | 138 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | render_png | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | describe | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | describe_sdk | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | verify | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | execute | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | mutate | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-streamable | build | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-modern | render_svg | 69 | 0 | 0 | 0 | 0 | 0 |
| node:24.19.0 | mcp:hosted-modern | render_ascii | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | load | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | svg | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | svg-async | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | svg-receipt | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | ascii | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | unicode | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | png | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | heap-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:global | download-closure | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:lazy | load | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:lazy | svg | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:lazy | svg-receipt | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:lazy | heap-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:lazy | download-closure | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | load | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | preview | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | ascii | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | unicode | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | png | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | heap-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:worker | download-closure | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:editor | load | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:editor | input-preview | 69 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:editor | heap-checkpoint | 3 | 0 | 0 | 0 | 0 | 0 |
| chromium:154.0.8037.57 | browser:editor | download-closure | 3 | 0 | 0 | 0 | 0 | 0 |

## Agentic family functionality and operation witnesses

Fresh direct-package probes observed **44 / 279 advertised family–operation kinds**. The remaining **235** have no direct generic witness in this run. The separately orchestrated owning tests exercise additional behavior, but their passes are not automatically credited as packed-package operation closure.

| Family | Owner inputs | Passed / failed observations | Direct operation kinds / advertised |
|---|---:|---:|---:|
| flowchart | 198 | 1184 / 1 | 1 / 14 |
| state | 81 | 462 / 0 | 1 / 18 |
| sequence | 129 | 770 / 6 | 1 / 15 |
| timeline | 16 | 98 / 0 | 3 / 15 |
| class | 42 | 252 / 0 | 2 / 16 |
| er | 68 | 404 / 0 | 1 / 12 |
| journey | 9 | 56 / 0 | 3 / 14 |
| architecture | 22 | 132 / 0 | 2 / 20 |
| xychart | 47 | 284 / 0 | 2 / 10 |
| pie | 18 | 110 / 0 | 2 / 7 |
| quadrant | 29 | 176 / 0 | 2 / 7 |
| gantt | 77 | 342 / 0 | 3 / 13 |
| mindmap | 7 | 44 / 0 | 2 / 10 |
| gitgraph | 7 | 44 / 0 | 2 / 11 |
| radar | 16 | 98 / 0 | 3 / 14 |
| sankey | 15 | 92 / 0 | 1 / 4 |
| c4 | 7 | 44 / 0 | 2 / 18 |
| packet | 40 | 180 / 0 | 2 / 8 |
| kanban | 51 | 302 / 0 | 2 / 13 |
| requirement | 16 | 98 / 0 | 1 / 12 |
| treemap | 41 | 248 / 0 | 2 / 10 |
| ishikawa | 21 | 128 / 0 | 3 / 7 |
| block | 37 | 224 / 0 | 1 / 11 |

Counts describe fresh executable evidence, not exhaustive language-feature coverage. Historical parser/layout assertions, output envelopes, negative cases and independent rendered-label correspondence retain their separate scopes; not-applicable observations are not failures.

**Explicit latest family empty-fixture correction:** Explicit empty-fixture SVG positive-canvas eligibility repair only. Every target receives a fresh full994 one-pass functionality run; corrected display results preserve exact original unselected observations and replace only independently empty, actually empty, previously sole-canvas-failed render-svg rows with fresh N/A. Original family and all performance evidence remain immutable. This is not product improvement.. 72 independently empty SVG observations across 12 targets become unscored N/A using exact fresh evidence. All other original functionality observations and every performance measurement remain unchanged. Manifest: /workspace/mermaid-unified-2026-10-24/family-empty-correction/manifest.json.


## Active PR comparisons

Frozen 2026-10-25T00:30:26.476Z against main `c31d16d002adcad518b7fa9fa67f85d9be26eba6`. SVG/receipt portfolios use the same six fully consumed artifacts; import and first-SVG retain their distinct worker boundaries. Community plain-API timings above are a different boundary.

The result-cache flag is explicit: **0 = result reuse off**, **1 = result reuse enabled**; other artifact/cache defaults remain unchanged. Flag 0 is not a cold process, cold OS cache or fully uncached renderer. Receipt/edit columns use flag 1.

Receipt assertion boundary: pre-post-outside-clocks. Historical and latest receipt clocks have different assertion boundaries, so these separate snapshots do not establish a direct product cost trend. Family functionality runs once; historical rounds3 metadata records a request, not three executed functionality passes.

Focused API-only campaign. Selected metrics: svg, svgReceipt, firstSvg, import. Omitted terminal/edit/PNG metrics and broad invocation suites were not executed; no full thirteen-metric comparison is implied. Family functionality executes one pass; three performance rounds were requested separately. Historical family metadata also requested three rounds but did not repeat functionality checks.

| Candidate | Frozen head | State | SVG ratio: reuse off (0) | SVG ratio: reuse enabled (1) | SVG receipt ratio (1) | First SVG ratio (1) | Import ratio (1) | npm tarball, KiB | Shipped browser gzip, KiB |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| PR #472 | `cb897e56487d` | integrated | 1.006× (tie) | 0.944× | 1.020× (tie) | 0.955× (tie) | 1.052× (tie) | 5761.0 | 1153.1 |
| PR #484 | `97bd834fb7d5` | integrated · draft | 0.994× (tie) | 0.951× (tie) | 0.984× (tie) | 0.998× (tie) | 0.932× (tie) | 5762.3 | 1153.2 |
| PR #374 | `2ed20a17e323` | conflicting-head | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5440.2 | 1036.5 |
| PR #480 | `6792a2687d4c` | integrated · draft | 0.980× (tie) | 0.998× (tie) | 0.901× | 0.960× (tie) | 0.950× (tie) | 5759.9 | 1153.5 |
| PR #479 | `a103b19f7a00` | integrated · draft · evidence pr-480 | 0.980× | 0.998× | 0.901× | 0.960× | 0.950× | 5759.9 | 1153.5 |
| Frozen main | `c31d16d002ad` | main | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 5757.9 | 1153.3 |
| PR #374 | `8a49c285b4c8` | branch-base | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5437.7 | 1036.5 |
| PR #365 | `8a49c285b4c8` | branch-base · evidence base-374 | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5437.7 | 1036.5 |
| PR #449 | `ab3d0d886e31` | integrated · draft | 1.046× (tie) | 1.015× (tie) | 0.965× (tie) | 0.973× (tie) | 0.969× (tie) | 5842.5 | 1179.8 |
| PR #365 | `45f3567dd13c` | conflicting-head | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5439.6 | 1036.4 |
| PR #471 | `2257ca9a311e` | integrated · draft | 1.014× (tie) | 1.028× (tie) | 0.996× (tie) | 0.968× (tie) | 1.013× (tie) | 5758.5 | 1153.3 |
| PR #393 | `7c891e185763` | integrated · evidence pr-471 | 1.014× | 1.028× | 0.996× | 0.968× | 1.013× | 5762.3 | 1153.3 |

### Supplemental cases outside the six-core aggregate

| Candidate | State | Case | Metric | Result reuse flag | Status | Paired ratio |
|---|---|---|---|---:|---|---:|
| main | main | gitGraph20 | svg | 1 | passed | 1.000× (tie) |
| main | main | gitGraph20 | svgReceipt | 1 | passed | 1.000× (tie) |
| main | main | gitGraph20 | svg | 0 | passed | 1.000× (tie) |
| main | main | gitGraph20 | svgReceipt | 0 | passed | 1.000× (tie) |
| pr-484 | integrated | gitGraph20 | svg | 1 | passed | 0.976× (tie) |
| pr-484 | integrated | gitGraph20 | svgReceipt | 1 | passed | 1.014× (tie) |
| pr-484 | integrated | gitGraph20 | svg | 0 | passed | 0.886× (tie) |
| pr-484 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.994× (tie) |
| pr-480 | integrated | gitGraph20 | svg | 1 | passed | 0.860× |
| pr-480 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.893× |
| pr-480 | integrated | gitGraph20 | svg | 0 | passed | 0.885× (tie) |
| pr-480 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.895× (tie) |
| pr-479 | integrated | gitGraph20 | svg | 1 | passed | 0.860× |
| pr-479 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.893× |
| pr-479 | integrated | gitGraph20 | svg | 0 | passed | 0.885× |
| pr-479 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.895× |
| pr-472 | integrated | gitGraph20 | svg | 1 | passed | 1.311× (tie) |
| pr-472 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.993× (tie) |
| pr-472 | integrated | gitGraph20 | svg | 0 | passed | 1.026× (tie) |
| pr-472 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.986× (tie) |
| pr-471 | integrated | gitGraph20 | svg | 1 | passed | 0.988× (tie) |
| pr-471 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.989× (tie) |
| pr-471 | integrated | gitGraph20 | svg | 0 | passed | 0.947× (tie) |
| pr-471 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.908× (tie) |
| pr-449 | integrated | gitGraph20 | svg | 1 | passed | 1.075× |
| pr-449 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.998× (tie) |
| pr-449 | integrated | gitGraph20 | svg | 0 | passed | 1.014× (tie) |
| pr-449 | integrated | gitGraph20 | svgReceipt | 0 | passed | 1.107× (tie) |
| pr-393 | integrated | gitGraph20 | svg | 1 | passed | 0.988× |
| pr-393 | integrated | gitGraph20 | svgReceipt | 1 | passed | 0.989× |
| pr-393 | integrated | gitGraph20 | svg | 0 | passed | 0.947× |
| pr-393 | integrated | gitGraph20 | svgReceipt | 0 | passed | 0.908× |
| pr-374 | conflicting-head | gitGraph20 | svg | 1 | passed | 1.073× (tie) |
| pr-374 | conflicting-head | gitGraph20 | svgReceipt | 1 | passed | 0.999× (tie) |
| pr-374 | conflicting-head | gitGraph20 | svg | 0 | passed | 1.014× (tie) |
| pr-374 | conflicting-head | gitGraph20 | svgReceipt | 0 | passed | 0.985× (tie) |
| base-374 | branch-base | gitGraph20 | svg | 1 | passed | 1.000× (tie) |
| base-374 | branch-base | gitGraph20 | svgReceipt | 1 | passed | 1.000× (tie) |
| base-374 | branch-base | gitGraph20 | svg | 0 | passed | 1.000× (tie) |
| base-374 | branch-base | gitGraph20 | svgReceipt | 0 | passed | 1.000× (tie) |
| pr-365 | conflicting-head | gitGraph20 | svg | 1 | passed | 1.044× (tie) |
| pr-365 | conflicting-head | gitGraph20 | svgReceipt | 1 | passed | 1.034× |
| pr-365 | conflicting-head | gitGraph20 | svg | 0 | passed | 0.973× (tie) |
| pr-365 | conflicting-head | gitGraph20 | svgReceipt | 0 | passed | 0.991× (tie) |
| base-365 | branch-base | gitGraph20 | svg | 1 | passed | 1.000× |
| base-365 | branch-base | gitGraph20 | svgReceipt | 1 | passed | 1.000× |
| base-365 | branch-base | gitGraph20 | svg | 0 | passed | 1.000× |
| base-365 | branch-base | gitGraph20 | svgReceipt | 0 | passed | 1.000× |

These separately paired source cases can reveal work hidden by the common core. They do not change its cohort, denominator or aggregate stack rank.

### Candidate functionality and editor delivery

Lifecycle and invocation counts describe their own checks; they are not portable-parser fidelity scores. N/A observations are excluded from the scored denominator. Initial editor bytes are an observed requested-file closure compressed with gzip, distinct from the complete shipped IIFE.

| Candidate | Family lifecycle passed / scored | Invocation passed / scored | Invocation profile / rounds | Initial editor gzip, KiB | Through-family editor gzip, KiB |
|---|---:|---:|---|---:|---:|
| Frozen main [main · main · c31d16d002ad] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #484 [pr-484 · integrated · 97bd834fb7d5] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #480 [pr-480 · integrated · 6792a2687d4c] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #479 [pr-479 · integrated · a103b19f7a00] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #472 [pr-472 · integrated · cb897e56487d] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #471 [pr-471 · integrated · 2257ca9a311e] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #449 [pr-449 · integrated · ab3d0d886e31] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #393 [pr-393 · integrated · 7c891e185763] | 5766 / 5773 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #374 [pr-374 · conflicting-head · 2ed20a17e323] | 4735 / 5793 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #374 [base-374 · branch-base · 8a49c285b4c8] | 4735 / 5793 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #365 [pr-365 · conflicting-head · 45f3567dd13c] | 4735 / 5793 | Not selected / unavailable | full / 0 | N/A | N/A |
| PR #365 [base-365 · branch-base · 8a49c285b4c8] | 4735 / 5793 | Not selected / unavailable | full / 0 | N/A | N/A |

Full per-metric rows, fresh bracketing controls, broad family/invocation results and artifact identities: [PR campaign evidence](../../mermaid-unified-2026-10-24/prs-latest/pr-ranks.json). Source-conflicting heads and own bases stay exploratory; no merge readiness is implied.

## Historical full PR snapshot

Frozen 2026-10-24T18:31:59.602Z against main `dce89b73d00bf9d4b8f847b1ab261d9c58e06083`. SVG/receipt portfolios use the same six fully consumed artifacts; import and first-SVG retain their distinct worker boundaries. Community plain-API timings above are a different boundary.

The result-cache flag is explicit: **0 = result reuse off**, **1 = result reuse enabled**; other artifact/cache defaults remain unchanged. Flag 0 is not a cold process, cold OS cache or fully uncached renderer. Receipt/edit columns use flag 1.

Receipt assertion boundary: includes-external-receipt-validation (historical worker). Historical and latest receipt clocks have different assertion boundaries, so these separate snapshots do not establish a direct product cost trend. Family functionality runs once; historical rounds3 metadata records a request, not three executed functionality passes.

| Candidate | Frozen head | State | SVG ratio: reuse off (0) | SVG ratio: reuse enabled (1) | SVG receipt ratio (1) | Unicode receipt ratio (1) | Verified edit ratio (1) | npm tarball, KiB | Shipped browser gzip, KiB |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| PR #476 | `05a643d688e7` | integrated · draft | 0.954× | 0.958× (tie) | 0.928× | 1.006× (tie) | 0.958× (tie) | 5748.6 | 1150.1 |
| PR #472 | `b2206c8324ef` | integrated | 0.947× (tie) | 0.959× (tie) | 1.021× (tie) | 1.034× | 0.983× (tie) | 5748.7 | 1149.8 |
| PR #374 | `2ed20a17e323` | conflicting-head | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5440.2 | 1036.5 |
| Frozen main | `dce89b73d00b` | main | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 1.000× (tie) | 5748.1 | 1149.9 |
| PR #449 | `2cff725d219c` | branch-base | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5861.1 | 1148.6 |
| PR #374 | `8a49c285b4c8` | branch-base | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5437.7 | 1036.5 |
| PR #365 | `8a49c285b4c8` | branch-base · evidence base-374 | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5437.7 | 1036.5 |
| PR #365 | `45f3567dd13c` | conflicting-head | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5439.6 | 1036.4 |
| PR #449 | `d3dd6d1c3f07` | conflicting-head · draft | Exploratory | Exploratory | Exploratory | Exploratory | Exploratory | 5951.3 | 1175.2 |
| PR #471 | `2257ca9a311e` | integrated · draft | 1.009× (tie) | 1.017× (tie) | 1.070× (tie) | 0.954× (tie) | 0.972× (tie) | 5748.7 | 1149.9 |
| PR #393 | `7c891e185763` | integrated · evidence pr-471 | 1.009× | 1.017× | 1.070× | 0.954× | 0.972× | 5749.7 | 1149.9 |

### Candidate functionality and editor delivery

Lifecycle and invocation counts describe their own checks; they are not portable-parser fidelity scores. N/A observations are excluded from the scored denominator. Initial editor bytes are an observed requested-file closure compressed with gzip, distinct from the complete shipped IIFE.

| Candidate | Family lifecycle passed / scored | Invocation passed / scored | Invocation profile / rounds | Initial editor gzip, KiB | Through-family editor gzip, KiB |
|---|---:|---:|---|---:|---:|
| Frozen main [main · main · dce89b73d00b] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 132.4 | 1862.8 |
| PR #476 [pr-476 · integrated · 05a643d688e7] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 132.4 | 1863.1 |
| PR #472 [pr-472 · integrated · b2206c8324ef] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 132.4 | 1862.7 |
| PR #471 [pr-471 · integrated · 2257ca9a311e] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 132.4 | 1862.9 |
| PR #449 [pr-449 · conflicting-head · d3dd6d1c3f07] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 130.2 | 1959.9 |
| PR #449 [base-449 · branch-base · 2cff725d219c] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 131.3 | 1937.2 |
| PR #393 [pr-393 · integrated · 7c891e185763] | 5766 / 5779 | 10056 / 10056; 2498 harness-blocked/unscored | smoke / 1 | 132.4 | 1862.9 |
| PR #374 [pr-374 · conflicting-head · 2ed20a17e323] | 4735 / 5799 | 6928 / 10114; 1578 harness-blocked/unscored | smoke / 1 | 1089.9 | 1709.6 |
| PR #374 [base-374 · branch-base · 8a49c285b4c8] | 4735 / 5799 | 6928 / 10114; 1578 harness-blocked/unscored | smoke / 1 | 1089.9 | 1709.6 |
| PR #365 [pr-365 · conflicting-head · 45f3567dd13c] | 4735 / 5799 | 6928 / 10114; 1578 harness-blocked/unscored | smoke / 1 | 1089.9 | 1709.6 |
| PR #365 [base-365 · branch-base · 8a49c285b4c8] | 4735 / 5799 | 6928 / 10114; 1578 harness-blocked/unscored | smoke / 1 | 1089.9 | 1709.6 |

Full per-metric rows, fresh bracketing controls, broad family/invocation results and artifact identities: [PR campaign evidence](../../mermaid-unified-2026-10-24/prs-current/pr-ranks.json). Source-conflicting heads and own bases stay exploratory; no merge readiness is implied.

## Original suite ledger

Original statuses and clocks remain the source of truth for the complete orchestration. Scoped protocol repairs above do not turn this into a newly passing full run. Owning test counts refer to actual independent process summaries, not stored witness metadata.

| Suite | Status | Complete wall time, s | Owning tests pass / fail / skip |
|---|---|---:|---|
| family | failed | 31.6 | N/A |
| invocation | failed | 3337.0 | N/A |
| pinned-reference-score | failed | 70.3 | N/A |
| community | failed | 3134.0 | N/A |
| samples | passed | 4.0 | N/A |
| dave | passed | 171.3 | N/A |
| micro | passed | 473.0 | N/A |
| experiments | passed | 300.6 | N/A |
| pipeline | passed | 21.3 | N/A |
| peers | passed | 391.3 | N/A |
| release | failed | 1371.0 | N/A |
| release:browser | passed | 274.1 | N/A |
| render-stages | passed | 20.0 | N/A |
| performance-profile | passed | 13.3 | N/A |
| output-identity | passed | 118.0 | N/A |
| editor-preview | passed | 3.8 | N/A |
| editor-session | passed | 184.3 | N/A |
| editor-ownership | failed | 0.8 | N/A |
| renderer-profile | passed | 62.4 | N/A |
| browser-contracts | failed | 59.4 | 59 / 4 / 0 |
| distribution-cli | passed | 22.0 | 52 / 0 / 0 |
| distribution-native | passed | 1.4 | 4 / 0 / 0 |
| distribution-dist-fuzz | failed | 53.3 | 4 / 1 / 0 |
| distribution-tarball | failed | 86.6 | 9 / 1 / 0 |
| distribution-tarball-node22 | failed | 93.6 | 9 / 1 / 0 |
| browser-lazy-delivery | passed | 4.6 | N/A |
| family-contracts | passed | 3.0 | 32 / 0 / 0 |
| family-functionality | failed | 216.4 | 4386 / 2 / 1 |
| upstream-imported | passed | 11.3 | 996 / 0 / 11 |
| pinned-semantic-tests | passed | 8.8 | 48 / 0 / 0 |
| pinned-operation-tests | passed | 4.7 | 53 / 0 / 0 |
| pinned-grammar-tests | passed | 2.4 | 23 / 0 / 0 |
| pinned-semantic-corpus | passed | 89.3 | N/A |
| pinned-grammar-corpus | passed | 53.3 | N/A |
| family-portfolio | passed | 0.3 | N/A |
| agent-replay | passed | 2.7 | 52 / 0 / 0 |
| agent-live | blocked | N/A | N/A |
| mcp-conformance | passed | 5.9 | N/A |
| style-audit | passed | 4.2 | 54 / 0 / 0 |
| sketch-check | passed | 0.7 | 102 / 0 / 0 |
| agent-subagent | blocked | N/A | N/A |
| layout-compare | passed | 6.4 | N/A |
| route-enumeration | passed | 36.1 | N/A |
| visual-rubric | passed | 2.6 | N/A |
| heuristic-tracker | passed | 1.8 | N/A |
| ugly-audit | passed | 71.9 | N/A |
| prs | skipped | N/A | N/A |

## Separate current-main Dave and parser evidence

Target `dce89b73d00bf9d4b8f847b1ab261d9c58e06083`, measured **2026-10-24T19:00:37.164Z → 2026-10-24T19:03:50.671Z**. Actual candidate tarball SHA256: `cc42363433b610c3d475029be305226756248addf03b5bd0092d3cfe70e84fa6`. This supplemental run does not relabel the original full suite ledger or its older-target corrections.

### Dave exact pinned corpus

All 1095 original source occurrences, unchanged browser and clock policy, three rounds. Complete attempt costs include failures and cannot reward fast rejection. Dave uses historical Pele 1.6.0; expanded community Pele 1.9.0 is a separate version/boundary.

| Implementation | Version | Accepted / 1095 | Median complete attempt portfolio, ms |
|---|---|---:|---:|
| candidate | 0.4.2 | 823 / 1095 | 3982.50 |
| pele | 1.6.0 | 1063 / 1095 | 269.80 |
| mermaid | 12.2.0 | 1061 / 1095 | 31659.00 |
| bezel | 0.2.20 | 1063 / 1095 | 503.90 |

| Comparator | Shared-success inputs | Agentic / comparator cost |
|---|---:|---:|
| pele | 823 | 19.902× |
| mermaid | 821 | 0.152× |
| bezel | 823 | 12.456× |

Each comparator has its own exact shared-success cohort; ratios below 1 favor Agentic. No common overall cross-tool rank is inferred.

### Current target on the same pinned parser positives

580 eligible positives; all 586 raw sources retained, including 6 diagnostic-only cases. Identical literal sources, independently expected criteria, reviewed eligibility and Mermaid/parser/DOM pins are verified against original frozen evidence.

| Parser | Portable criteria passed / evaluated per round | Shared-qualified cases | Shared-qualified parse portfolio, ms |
|---|---:|---:|---:|
| agentic | 2479 / 2607 (each of 3 rounds) | 512 | 106.60 |
| mermaid | 2607 / 2607 (each of 3 rounds) | 512 | 2402.45 |

Parser clocks exclude semantic projections, assertions and transport. Shared-success cost requires both engines in every round; unscored historical layout counts and diagnostic-only cases are excluded. The old-target baseline repair and the actual current product are separate measurements.

## Additional maintained target-owned suites

Completed 2026-10-25T02:28:26.123Z → 2026-10-25T04:22:06.307Z against `c31d16d002adcad518b7fa9fa67f85d9be26eba6`, archive SHA256 `5d0292e5e64920448d1ccac1e29d06e71b028e53153e9f5832e6135b90b606c7`. Actual owning source Git objects are verified. This separate ledger does not merge ranks, overwrite original statuses or relabel other suites as current.
Actual qualification status: **uncalibrated**. Diagnostic actual candidate versus the explicitly supplied previous-main baseline. Historical-anchor constants do not identify this baseline. Historical published-release budget qualification is not established; completed uncalibrated gates are not performance-qualified. Actual baseline 0.4.2 at dce89b73d00bf9d4b8f847b1ab261d9c58e06083, SHA256 cc42363433b610c3d475029be305226756248addf03b5bd0092d3cfe70e84fa6. The historical anchor constant does not identify this supplied baseline.

| Suite | Status | Complete wall time, s | Owning source Git blob | Observations passed / failed / blocked / N/A |
|---|---|---:|---|---|
| peers:qualify | uncalibrated | 6820.1 | `6e449e15258fdce83585c9decdaaa8689816eaa4` | 1 / 0 / 0 / 0 |

Owning status **uncalibrated**, complete=true, performanceQualified=false; original outer ledger status passed is retained. A completed process is not calibrated qualification.

- Process completion is recorded; detailed per-input qualification remains in the owning suite artifacts.

Full owning reports, gates and artifacts: [additional suite ledger](../../mermaid-unified-2026-10-24/late-matched-current/report.md). Missing or insufficient qualification stays explicit; process completion alone is not a passing gate.

**Explicit latest Dave display correction:** Explicit Dave-only display correction after premeasurement npm-cache acquisition failure. Original failed ledger remains immutable; actual fresh clocks and artifact identity come only from this new completed Dave run. Original status failed at /workspace/mermaid-unified-2026-10-24/latest-main-full; fresh Dave evidence /workspace/mermaid-unified-2026-10-24/latest-main-dave.


## Independent latest invocation: complete declared attempt census

Target c31d16d002adcad518b7fa9fa67f85d9be26eba6; 2026-10-25T01:18:25.443Z → 2026-10-25T02:19:33.221Z, full profile / three rounds. Actual target archive SHA256 5d0292e5e64920448d1ccac1e29d06e71b028e53153e9f5832e6135b90b606c7. Independent latest-target invocation plus Dave/pinned-reference campaign. Actual attempt census distinguishes completion from success; raw observations and statuses retained. Does not replace the older complete run, style correction, DCE community or older Dave/parser results. Representative-family routing is not exhaustive syntax/functionality proof.

| Representative inputs | Observations | Passed | Failed | Blocked | N/A | Result |
|---:|---:|---:|---:|---:|---:|---|
| 23 | 62941 | 62938 | 3 | 0 | 0 | failed |

Actual repaired library XML qualifier: saxes 6.0.0. This latest target is independent from the older community/Dave/parser snapshots and original corrected invocation counts. Raw evidence: /workspace/mermaid-unified-2026-10-24/latest-main-full/invocation/invocation.json.

Actual execution census: **complete declared attempt census**. Complete attempts never means all passed or every public function exercised. Render/watch rounds are sidecar-observed; common CLI helper verbs intentionally run once. Nonrenderer exports retain import/discovery and explicit unmeasured function witnesses. Public function exports without direct operation witnesses remain explicitly unmeasured: 45 export/runtime/round groups; full names are retained in admitted chart data.


Separately built native/site source proof: /workspace/mermaid-unified-2026-10-24/prep/latest-main-invocation-assets.json. Native executable SHA256 2823f27821c0a0c6bd3b987d32aabfc8ca9e5b7b9ecd0ce431013c751f420305; 382 admitted built website files. npm archive identity alone does not identify the compiled executable.

### Latest pinned Dave and parser evidence

| Dave engine | Accepted / identical occurrences | Median full attempt cost, ms |
|---|---:|---:|
| candidate | 823 / 1095 | 3568.60 |
| pele | 1063 / 1095 | 276.00 |
| mermaid | 1061 / 1095 | 29470.90 |
| bezel | 1063 / 1095 | 369.00 |

| Dave matched comparator | Identical shared-qualified occurrences | Candidate / comparator median ratio |
|---|---:|---:|
| pele | 823 | 18.282× |
| mermaid | 821 | 0.147× |
| bezel | 823 | 14.343× |

Dave attempt costs include each engine’s own accepted/rejected workload. Only matched-pair portfolios support a speed ratio. Dave keeps historical Pele1.6/Mermaid12.2/Bezel pins; the wider community measures separate versions and clocks.

| Parser | Portable criteria passed / scored in each round | Eligible positive cases |
|---|---|---:|
| agentic | 2479 / 2607; 2479 / 2607; 2479 / 2607 | 580 |
| mermaid | 2607 / 2607; 2607 / 2607; 2607 / 2607 | 580 |

Shared-qualified parser cohort: 512 identical positive cases, both engines and every round.

| Parser | Median public parse portfolio, ms |
|---|---:|
| agentic | 94.17 |
| mermaid | 2240.49 |

Retained raw inputs 586; reviewed diagnostics 6 remain outside positive scoring. Current Mermaid reference 12.2.0 at 1fb7869866dd619168d840291c9c54b4f129758b. Imported historical fixture pins remain separate. Parser timing uses shared-qualified cases separately from assertions/semantic scoring; see the latest standalone charts and raw result.

## Independent owning and environment corrections

These ledgers preserve their actual driver/target revision, fixture scope, statuses and process wall times. They do not overwrite the original suite ledger or change comparative ranks.

| Suite | Driver revision | Target revision | Status | Process wall, s | Owning tests pass / fail / skip |
|---|---|---|---|---:|---|
| browser-contracts | 28b97bf35ab6f181eb243777d05ff0175551f0b6 (dirty harness recorded) | 28b97bf35ab6f181eb243777d05ff0175551f0b6 | passed | 216.1 | 127 / 0 / 0 |

Raw independent ledger: /workspace/mermaid-unified-2026-10-24/corrections/browser-provisioned; 2026-10-24T18:38:32.417Z → 2026-10-24T18:42:08.542Z.
| family-functionality | f7e468790b405ba4cf375b623f1d58a4012c1fe5 (dirty harness recorded) | 2cff725d219c75b75593b1d3e9bacd74cba7a08e | failed | 220.8 | 4387 / 1 / 1 |

Raw independent ledger: /workspace/mermaid-unified-2026-10-24/corrections/family-owner; 2026-10-24T18:24:47.716Z → 2026-10-24T18:28:28.574Z.
| editor-ownership | f7e468790b405ba4cf375b623f1d58a4012c1fe5 (dirty harness recorded) | 2cff725d219c75b75593b1d3e9bacd74cba7a08e | passed | 8.1 | N/A |

Frozen ownership fixture: /workspace/mermaid-community-2026-10-22-rebased/editor-ownership-site. Historical external frozen original/candidate page pair; fixture-specific ownership proof, not current target performance. Page artifact identities remain in the admitted report metadata.

Raw independent ledger: /workspace/mermaid-unified-2026-10-24/corrections/ownership; 2026-10-24T18:26:10.026Z → 2026-10-24T18:26:18.157Z.
| peers:qualify | a1c34d14f77ef3f6e11ae1c6d983d3eb60defc1c | dce89b73d00bf9d4b8f847b1ab261d9c58e06083 | failed | 3.5 | N/A |

Raw independent ledger: /tmp/mermaid-late-maintained; 2026-10-25T02:20:14.275Z → 2026-10-25T02:20:17.776Z.

## Remaining gaps and limits

- Dicklesworthstone/frankenmermaid: Catalog declares terminal; no benchmark output adapter is bound. This capability is unmeasured.
- Dicklesworthstone/frankenmermaid: Catalog declares diagnostics; no benchmark output adapter is bound. This capability is unmeasured.
- Dicklesworthstone/frankenmermaid: Catalog declares source; no benchmark output adapter is bound. This capability is unmeasured.
- wevm/ondine: Catalog declares terminal; no benchmark output adapter is bound. This capability is unmeasured.
- orestesgaolin/mermaid: Catalog declares png; no benchmark output adapter is bound. This capability is unmeasured.
- crafter-station/mermaid: Catalog declares terminal; no benchmark output adapter is bound. This capability is unmeasured.
- justsml/rusty-mermaid: Error: Cannot resolve the actual Node import-condition export rusty-mermaid: node:internal/modules/esm/resolve:201   const resolvedOption = FSLegacyMainResolve(pkgPath, packageConfig.main, baseStringified);                          ^  Error: Cannot find package '/workspace/agentic-mermaid-unified-benchmark/node_modules/.cache/unified-community/rusty-mermaid@0.42.0/node_modules/rusty-mermaid/pkg/rusty_mermaid.js' imported from /workspace/agentic-mermaid-unified-benchmark/node_modules/.cache/unified-community/rusty-mermaid@0.42.0/node_modules/rusty-mermaid/package.json     at legacyMainResolve (node:internal/modules/esm/resolve:201:26)     at packageResolve (node:internal/modules/esm/resolve:778:12)     at moduleResolve (node:internal/modules/esm/resolve:859:18)     at defaultResolve (node:internal/modules/esm/resolve:992:11)     at #cachedDefaultResolve (node:internal/modules/esm/loader:701:20)     at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:721:38)     at ModuleLoader.resolveSync (node:internal/modules/esm/loader:759:56)     at Object.resolve (node:internal/modules/esm/initialize_import_meta:37:25)     at file:///workspace/agentic-mermaid-unified-benchmark/[eval1]:1:34     at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {   code: 'ERR_MODULE_NOT_FOUND' }  Node.js v24.19.0
- Latias94/merman: Catalog declares jpeg; no benchmark output adapter is bound. This capability is unmeasured.
- Latias94/merman: Catalog declares pdf; no benchmark output adapter is bound. This capability is unmeasured.
- Latias94/merman: Catalog declares terminal; no benchmark output adapter is bound. This capability is unmeasured.
- SVG XML/canvas and authored-label checks do not establish complete semantic identity, multiplicity, route geometry or visual fidelity. Dedicated family feature assertions remain separate.
- Core repeat cases calibrate to20ms/256iterations. With communityCoverageOnce, feature-corpus inputs qualify one actual call in round1 without warm/repeated speed samples; later rounds contain core only. These protocols never share a speed aggregate. API clocks exclude validation/cleanup; internal DOM measurement belongs to the API. JS heap excludes native/WASM/process memory.
- blackst0ne/mermaid round 1: Error: Browser API workload exceeded 30s
- ioggstream/d3fend-mermaid round 1: Error: Browser API workload exceeded 30s
- jacob-lcs/mermaid round 1: Error: Browser API workload exceeded 30s
- Mermaid-Chart/mermaid-develop round 1: Error: Browser API workload exceeded 30s
- NicolasNewman/mermaid round 1: Error: Browser API workload exceeded 30s
- xeolabs/mermaid round 1: Error: Browser API workload exceeded 30s
- zakaria-forks/mermaid round 1: Error: Browser API workload exceeded 30s
- blackst0ne/mermaid round 2: Error: Browser API workload exceeded 30s
- blackst0ne/mermaid round 3: Error: Browser API workload exceeded 30s
- Mixed-window correctness-qualification evidence. Engine bytes, sources, labels, protocols, pins and target remain frozen. SVG/IR timings are fresh under repaired admission; unaffected observations are exact original JSON. No product speed-improvement attribution.

Blocked comparator acquisition:

- **justsml/rusty-mermaid:** Error: Cannot resolve the actual Node import-condition export rusty-mermaid: node:internal/modules/esm/resolve:201   const resolvedOption = FSLegacyMainResolve(pkgPath, packageConfig.main, baseStringified);                          ^  Error: Cannot find package '/workspace/agentic-mermaid-unified-benchmark/node_modules/.cache/unified-community/rusty-mermaid@0.42.0/node_modules/rusty-mermaid/pkg/rusty_mermaid.js' imported from /workspace/agentic-mermaid-unified-benchmark/node_modules/.cache/unified-community/rusty-mermaid@0.42.0/node_modules/rusty-mermaid/package.json     at legacyMainResolve (node:internal/modules/esm/resolve:201:26)     at packageResolve (node:internal/modules/esm/resolve:778:12)     at moduleResolve (node:internal/modules/esm/resolve:859:18)     at defaultResolve (node:internal/modules/esm/resolve:992:11)     at #cachedDefaultResolve (node:internal/modules/esm/loader:701:20)     at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:721:38)     at ModuleLoader.resolveSync (node:internal/modules/esm/loader:759:56)     at Object.resolve (node:internal/modules/esm/initialize_import_meta:37:25)     at file:///workspace/agentic-mermaid-unified-benchmark/[eval1]:1:34     at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {   code: 'ERR_MODULE_NOT_FOUND' }  Node.js v24.19.0

Raw source of truth: /workspace/mermaid-unified-2026-10-24/all. Re-run the benchmark commands to refresh; do not hand-edit numbers or reuse old clocks as new evidence.


<!-- portable-pele-case-study:start -->
## Pele portable calibration, 25 October 2026

The new [Pele case study](../eval/benchmark/PELE-CASE-STUDY.md) measured only Pele
1.9.0 against same-artifact controls. It does not replace the historical ranks
above or establish a new cross-project winner.

Across 49 authored cases and 23 families, 15,930 workers made 2,804,100 timed
calls with zero declared check failures or blocked workers. All 46 valid cases
were accepted and all three invalid cases rejected. Declared native/painted
criteria were complete for 28 positive cases; 18 remain paint-unmeasured.
Timing calibrated for 84/149 rows, including all 49 first-use rows. The other
65 rows retain their noise failure, rather than gaining a precision claim.
An unchanged repeat reused record `e7322d5f-2742-4b3c-afa2-1d76d8918572` without
launching timing workers. No other community project was retimed.

The [suite overview](../eval/benchmark/OVERVIEW.md) describes how to compare these
lanes and where coverage remains partial.
<!-- portable-pele-case-study:end -->

<!-- primary-contract-results-2026-10-25:start -->
## Docs, original tests, required families and startup, 25 October 2026

These new lanes supplement the historical ranks above. They use the candidate
rebuilt after rebasing onto main `f8a2437b19e67a850145b786f72baf719da52837`.
Its publication archive SHA-256 is
`6ee46d4915028a25dd97dcbe4b834b1e3c5686537e2857dedf582b876eadd275`.
Benchmark changes do not establish a product optimization. Other community
implementations retain their earlier measurements and dates.

### Original Dave workload

Measured 18:35:37–18:37:42 UTC in Chromium 154, three counterbalanced rounds,
30 corpus warmups per engine/round, ELK cache disabled. All **1,095 official
fence occurrences**, representing 546 distinct examples across 34 pages,
remain in the denominator. This refreshed comparison set uses **Pele 1.9.0 in every lane**. Its actual
artifact versions must match the set manifest. The earlier Pele 1.6 Dave
measurement remains historical at `continuation/dave/`; it is not part of this
current set and has not been relabelled.

| Implementation | Returns SVG in every round | Complete browser bundle gzip |
| --- | ---: | ---: |
| Agentic Mermaid 0.4.2 | 823/1,095 | 1,166.0 KiB |
| Pele 1.9.0 | 1,063/1,095 | 257.1 KiB |
| Mermaid 12.2.0 | 1,061/1,095 | 1,534.1 KiB |

On the 823 shared-success occurrences, Agentic/Pele render-call ratios were
11.55, 21.43 and 22.29; median **21.43×**. Against Mermaid, the shared cohort
contains 821 occurrences and the median ratio is **0.14×**. This ranks returned
SVG work, excluding import, validation and paint. Failed cases cannot become
cheap successful renders. These three rounds do not provide a calibrated
release-regression claim or a tail-latency estimate.

Agentic's missing cases comprise 270 unsupported-family occurrences and two
Gantt examples rejected by the default raw-`themeCSS` security policy. Event
Modeling contributes 26 occurrences and ZenUML 32. Other excluded families
remain in Dave even when their beta status excludes them from the stable-family
requirement. Mermaid's own two asset/environment failures also remain visible.

The lazy Agentic entry fetches 5.4 KiB gzip initially and **231.9 KiB through
its first flowchart**. A bundled focused SVG consumer is 945.3 KiB gzip.
Those are different deployment choices; an unloaded loader is not a renderer,
and summing separately compressed files is not a single compressed archive.
SVG acceptance is not native-semantic or painted fidelity.

### Current original assertions and selected historical inputs

The original-callback lane executes unchanged expectations from pinned Mermaid
12.2.0 Mindmap/GitGraph specs through reviewed public-model adapters. The two
files contain 99 declarations expanding to 100 callbacks. Failures stop a
callback, so individual executed assertions are not a fixed score denominator.

| Implementation | Passed callbacks | Failed | Private/unavailable | Upstream skipped |
| --- | ---: | ---: | ---: | ---: |
| Agentic Mermaid | 75 | 15 | 6 | 4 |
| Pele 1.9.0 | 90 | 0 | 6 | 4 |
| Mermaid 12.2.0 | 90 | 0 | 6 | 4 |

Thirteen Agentic failures concern exact diagnostic wording despite actual
rejection; two concern empty cherry-pick tags represented differently. These
strict compatibility failures do not by themselves prove wrong drawings.
The unchanged original spec expects an empty array where the historical
adapted JSON expected an empty-string tag; the new lane exposes that old
adaptation error without rewriting either historical file.

The full monorepo inventory has **368 tracked spec/test files and 3,995 AST
test declarations**. Most remain unprojected. Literal replay receives no
original-assertion pass credit. Worker wall time includes imports, preparation,
facades and assertions; it is not unchanged upstream-runner time.

The separate selected-input reference lane accepted all 580 eligible inputs
in both engines. Per round, Agentic passed **2,498/2,626** criteria and Mermaid
**2,620/2,626**. This harvest contains Agentic-derived fields and existential
label checks. Mermaid's six misses also show why it must not be presented as
a complete fidelity oracle. Its scope and scores are not interchangeable with
the original-callback table.

### Required-family admission

Both implementations pass public SVG and authored-label admission for all
**20 policy-stable families**. Two unresolved maturity exclusions are retained
conservatively as required: Agentic admits **20/22**, Pele **21/22**. Pele's
additional admission is Event Modeling; ZenUML fails for both configured
artifacts. The review uncertainty blocks a complete-library claim.

Detailed implementation issues connect actual failures to open and closed
community work: [Event Modeling #501](https://github.com/adewale/agentic-mermaid/issues/501)
and [ZenUML #502](https://github.com/adewale/agentic-mermaid/issues/502). Source
preservation is not native support. One representative per family does not
exercise every feature, edit operation, configuration or painted relationship.

### Fresh entry startup and resources

The same authored small flowchart was consumed through the named SVG entries.
Each latency distribution has **25 fresh process observations** across five
rounds. p95 is nearest rank. Resource diagnostics use **five separate fresh
paired passes**; peak RSS is whole-child lifetime, reported here as its median.
Fresh processes do not imply a cold filesystem cache.

| Runtime | Project / public entry | First fully consumed result, median / p95 ms | Peak RSS, median MiB |
| --- | --- | ---: | ---: |
| Node 24.19 | Agentic root | 267.00 / 291.18 | 64.86 |
| Node 24.19 | Agentic `./svg` | 210.81 / 231.53 | 61.65 |
| Node 24.19 | Pele root | 63.14 / 70.15 | 37.09 |
| Bun 1.4.2 | Agentic root | 269.76 / 320.48 | 96.06 |
| Bun 1.4.2 | Agentic `./svg` | 256.19 / 290.12 | 74.69 |
| Bun 1.4.2 | Pele root | 96.53 / 108.03 | 59.54 |

Node import medians were 151.94 ms for Agentic root, 106.23 ms for `./svg`,
and 23.64 ms for Pele. Awaited first API calls were 85.40, 76.51 and 9.81 ms
respectively. Import and rendering both contribute to the gap. These separate
stage medians must not be added to synthesize a total. The focused entry's
shorter startup supports choosing a narrower interface; it is not a before/after
product speedup.

The campaign records 147 Agentic and 76 Pele primary interfaces with 25 latency
observations each, including explicitly separated namespace discovery. Agentic
also exercises CLI aliases and input modes, its compiled native CLI, MCP
stdio/HTTP, browser global/lazy/worker paths and the editor. Pele has no public
CLI in the admitted package. Its nine additional diagram-entry families have
import discovery but no independently authored startup-render fixture.
Every executed startup/resource row passed; hosted MCP remains blocked.

Import, API readiness, first consumed artifact and full CLI process completion
have different clocks. The full editor workload is an eight-input burst through
the latest verified DOM, not initial-preview startup. Browser document V8 heap
excludes worker/native/GPU/whole-browser memory; native CLI and MCP do not expose
injected JS snapshots. Memory domains overlap and cannot be stacked. CPU fields
have 10 ms resolution; observed zero is censored, not free work. Dollars need an
explicit rate or actual provider usage and are unavailable here.

### Retention, evidence and remaining work

Agentic startup ran 14:13:50–14:39:09 UTC; Pele ran 14:55:19–14:57:28 UTC.
The completed Agentic attempt needed publication metadata repair. Its raw
response, measurements and dates were preserved. An exact combined repeat
reused records `3dedb582-150e-4ac3-9ba7-52c09029f96d` and
`67b29bec-90cb-48ab-817d-07b43d87ca12` with no measurement workers. All three
original-assertion records also reused unchanged. Cancellation, identity
changes, duplicate experimental coordinates and recovery of the wrong attempt
are rejected; a corrected recovery request can retry without losing eligibility.

The current set manifest is `continuation/pele19-set/tool-versions.json`; its
refreshed Dave and Node peer measurements are in `pele19-set/dave/` and
`pele19-set/node-peer/`. Startup, resource, original-assertion and portable records that already used
Pele 1.9 retain their original clocks. Family admission received a fresh
functional recheck because the earlier publication fix changed its recorded
administrative closure; its outcomes are unchanged and it collects no latency
samples. The active shared
version policy rejects mixed releases for every tool before report publication,
including aliases for the same project. An explicit historical manifest permits
reviewing a separate uniform old set; it cannot mix old and current releases.

Raw reports and identities are retained under
`/workspace/mermaid-unified-2026-10-25/continuation/` in `dave/`,
`entry-startup-run/`, `upstream-run/`, `required-family-run/` and `records/`.
`entry-no-retiming-proof.json` verifies unchanged sample fields and dates.
The standalone chart reader lives in `eval/benchmark/visualizations/`; generated
charts and tables belong in the external evidence directory, not npm or CI.

The next useful coverage is original assertions beyond two families, richer
cross-feature/operation witnesses, native relationship and paint checks, and
initial editor/hosted/whole-browser memory measurements. There is no secret
holdout, calibrated new Agentic release comparison, or current-head rerun of
every open PR in this supplement. Earlier PR ranks retain their recorded heads.
The [overview](../eval/benchmark/OVERVIEW.md),
[inventory](../eval/benchmark/INVENTORY.md) and
[measurement rules](../eval/benchmark/MEASUREMENT.md) define the wider suite.
<!-- primary-contract-results-2026-10-25:end -->
