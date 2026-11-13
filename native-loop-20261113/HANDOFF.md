# Native cumulative improvement loop

Owner request: Astra Max audits the gaps, code, literature and other Mermaid
implementations; Sol 6.1 High implements cumulative simplifications; compare the
combined result with Native and ELK. Work began 2026-11-13T01:03:19Z. The minimum
twelve-hour horizon is 2026-11-13T13:03:19Z, not a claim of uninterrupted execution
or automatic completion. Earlier campaign deadlines are superseded.

- Repository: `/workspace/agentic-mermaid`, existing PR602 only.
- Baseline source: `68986ba8e3b76ad99dad44c6ec8d43475cc5e12f`.
- Integrated Main: `9136b07efb8944a1058de9834b18fe5916884174`.
- Baseline report: evidence commit `0ec8560ffe5e2e56b128972410d4039bf796142a`,
  `latest-main-full-trident-20261112/REPORT-FINAL.md`.
- State/lease: `/tmp/pr449-correctness-24h-20261030/campaign-state.json`.
- Coordinator lease owner: `astra-sol-native-loop-20261113`; renew or release
  under the existing lock. An enabled schedule does not authorize competing
  with an active writer or timing window.
- Audit/review agent: `/root/astra_gap_audit`, `gpt-6-astra`, Max; production
  read-only. Output under `audit/`.
- Sole production writer: `/root/sol_native_implementation`, `gpt-6.1-sol`,
  High. Output under `implementation/`; coordinate Git operations with root.
- At most three active agents including coordinator. One CPU timing stream;
  pause other local analysis, builds, browsers and profilers while it runs.
- Hourly continuation: `6ae0b82853508191843a984cfb468d5b`, enabled, next
  2026-11-13T02:05:00Z. Twelve-hour report: `6ae5e528d93881918a13186253dbae8e`,
  enabled for 2026-11-13T13:15:00Z. These schedules use Europe/London (UTC now).
  Continue meaningful work after that report if required gaps remain. Stop on
  owner instruction or demonstrated completion after the minimum horizon.

Keep named correctness failures, layout tradeoffs, proof unknowns and costs
separate. Current 99-input returns are not a universal correctness proof.
Exact contact/axis/glyph-collision observers remain unavailable. Do not replay
the unchanged full suite as progress, turn unknowns into passes, add another
backend, change defaults/caps/versions, or repeat falsified optimization probes.

Commit verified coherent milestones normally to the existing PR branch; push
meaningful recovery data to `review/pr449-evidence-20261105`. No new PR/issues,
force push/rebase, manual CI, merge or release. Preserve all evidence/work.

Current phase: exact-axis crossing subtraction is an uncommitted candidate,
164 owning tests and lint pass; 132 matched-build versus shipping-package
whole-product controls pass. Unprofiled cost comparison remains pending.
Astra's first causal shortlist is in `audit/early-causal-shortlist.md`; broader
literature/peer audit continues. Pele 1.9 source tag
`e7f092a4de147cc32210913c20e36eaa5fcd0ef1` is newly available for audit; the
missing historical peer render comparison remains unrecovered. No new
end-to-end gain or gap closure is claimed.

## First disposition

The exact-axis crossing gate is withdrawn after matched unprofiled costs.
Fan-in100 stock Native128.42→125.52ms, but full155.88→163.11ms; Chain100
full101.90→105.37ms and first edit134.86→174.94ms. These are matched local
build observations, not code gains against the earlier CI-host observation.
Sol is preserving the patch, all profiles and adverse cells, checking whole
products and restoring only the two owned source files. Do not retry gate
variants or favorable timing repeats. Next: Astra's bounded Pele compound
port-order counterexample and the distinct no-op route-contract hypothesis.

## New demonstrated support gap

Astra translated the pinned Pele three-group permutation into literal Mermaid.
At689, ELK returns all four directions with authored/Chromium paint checks;
Native returns TB and refuses LR/RL/BT under existing routing limits. Inputs,
full products and screenshots are in `audit/compound-permutation/`. The
pinned Mermaid12.2 syntax worker accepts all four sources. Broader identity
and two-group controls show ordering alone is not the refusal cause. Generic
global admission remains withdrawn: it repairs these12 controls but worsens
quality on working inputs, and prior broad trials had9/25 regressions.

Priority is now the Native compound refusal, before budget no-op optimization.
Sol owns production and the red owning table (1P/3F at689); Astra traces routing
selection and independently reviews. No raised cap, ELK fallback or third
backend. Current first-evidence checkpoint: `e72484908b56dc68fdc4dabf466f53f4648060e1`.
