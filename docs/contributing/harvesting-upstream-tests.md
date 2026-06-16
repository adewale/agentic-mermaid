# Harvesting Upstream Test Suites

How to turn "we are compatible with Mermaid" from a claim into a measured,
CI-gated number — by vendoring the *actual test suites* of upstream
implementations and running their inputs against ours. First applied to Gantt
(`eval/mermaid-gantt-bench/`); this guide generalizes the method so any family
can repeat it. Pairs with [`adding-diagram-types.md`](./adding-diagram-types.md):
do the harvest no later than the family's first release, and for not-yet-built
families do it **before** implementation — it is the cheapest way to learn the
real (as opposed to documented) semantics.

## What a harvest produces

```
eval/mermaid-<family>-bench/
  README.md        provenance (repos, files, fetch date, licenses), schema, reason codes
  cases.json       portable parity cases: upstream inputs + upstream-derived expectations
  exclusions.json  every upstream case we deliberately do NOT match, each with a reason
src/__tests__/<family>-upstream-bench.test.ts   the runner (CI, every PR)
```

The contract that keeps it honest:

1. **Every portable case passes.** Cases assert what upstream asserts —
   nothing more (our own stronger guarantees belong in our unit/property
   tests, not in the parity bench).
2. **Every exclusion is explained by a reason code**, and where the entry
   names an `oursErrorCode`, the runner **executes it** — proving we fail
   with exactly that named error. A divergence ledger that runs cannot rot.
3. **API-internal upstream tests are listed as not-portable** in the bench
   README (state-reset tests, internal helper unit tests, renderer DOM
   assertions) so "the entirety of their suite" is fully accounted for.

Template to copy: `eval/mermaid-gantt-bench/` +
`src/__tests__/gantt-upstream-bench.test.ts`.

## Where the upstream tests live

| Source | Path | What to take |
|---|---|---|
| mermaid grammar specs | `packages/mermaid/src/diagrams/<family>/parser/<family>.spec.js` | Source strings + structural assertions (titles, ids, tags, click bindings). Mostly portable. |
| mermaid semantics specs | `packages/mermaid/src/diagrams/<family>/<family>Db.spec.ts` (some families: `<family>Db.spec.js`, or logic specs beside the db) | The valuable layer: resolved values, ordering, edge cases. Portable after normalization; this is where wall-clock/TZ landmines hide. |
| mermaid rendering specs | `cypress/integration/rendering/<family>.spec.js` | Inputs only — assertions target THEIR svg dom. Usually redundant with the docs corpus. |
| mermaid docs examples | `packages/mermaid/src/docs/syntax/<file>.md` | Already wired: add the file to `FILE_TO_FAMILY` in `eval/mermaid-docs-corpus/build-corpus.ts` and floors to `src/__tests__/agent-mermaid-corpus.test.ts`. Docs are de facto behavior — they contain tolerated junk (see gotcha 3). |
| ASCII forks | `pgavlin/mermaid-ascii` (`pkg/<family>/<family>_test.go`), `kais-radwan/ascii-mermaid` (`ts/test/<family>.test.js`), `AlexanderGrooff/mermaid-ascii` | Inputs + render-smoke only; their byte-level output assertions are theirs. |
| oracle library | `mermaid-ast` (already a dependency) | A parsing differential (`<Family>.parse(...).toAST()`), not a semantics oracle — it does not resolve values. |

Fetch raw files from the `develop` branch
(`https://raw.githubusercontent.com/mermaid-js/mermaid/develop/<path>`), record
the fetch date in the bench README, and **check the license before vendoring**
(mermaid and both ASCII forks are MIT — attribute in the README; a repo with
no license file must not be vendored, only summarized).

## The method

1. **Read both spec files end to end** before extracting anything. Count the
   `it(`/`it.each` blocks; every one must land in cases.json, exclusions.json,
   or the README's not-portable list.
2. **Classify each test**: `parse` (structural fields), `schedule`/semantic
   (resolved values), `error` (both sides reject), excluded (reason code), or
   API-internal (not representable as diagram source — note it).
3. **Normalize expectations, never inputs.** Inputs are vendored verbatim.
   Their local-time `new Date(y, m, d)` tuples become UTC ISO strings; their
   auto-synthesized ids (`task1`…) become index-based assertions; their
   boolean tag flags become tag sets.
4. **Run, and treat every failure as information.** A failing harvested case
   is one of: a real bug in ours (fix it), a deliberate spec divergence (move
   to exclusions with a reason + executable error code), or an upstream
   behavior our spec should adopt (change ours — the gantt `tickInterval
   1decade` case). Decide explicitly; never weaken a case to make it pass.
5. **Gate it**: the runner is a normal `bun test` file; the docs-corpus floors
   are evidence-based and regression-only, with a comment naming each entry
   that holds the floor below 1.00 and why that is honest.
6. **Re-run the search before each release** for new upstream tests (the
   family's design doc should carry the watchlist of in-flight upstream
   syntax, as `docs/design/gantt.md` does).

## Exclusion reason codes

Reuse these before inventing new ones, and document any new code in the bench
README (the runner asserts every reason is documented):

- `wall-clock-fallback` — upstream substitutes `new Date()` for missing or
  unparseable inputs; our determinism contract mandates named errors. Always
  executable (`oursErrorCode`).
- `local-tz` — the upstream test only means something in a specific timezone
  (they themselves gate the gantt DST test behind `TZ=America/Los_Angeles`).
- `silent-ignore-vs-named-error` — upstream tolerates a token its own docs
  call unsupported; we error by name per the family spec.
- `exclude-boundary-model` (and siblings) — a real semantic difference,
  precisely characterized. Where possible state the conservation law both
  sides satisfy and exactly which inputs diverge.

## Gotchas the gantt harvest hit (check for each of these)

1. **Wall-clock expectations hide inside table tests** — scan for
   `new Date()` with no arguments and `setHours(0, 0, 0, 0)` in expected
   values, not just in implementation code.
2. **TZ/DST-gated tests** can't run verbatim against a UTC-only engine; port
   the input, assert our UTC behavior, ledger the difference.
3. **Official docs contain tolerated junk** (`tickInterval 1decade`, a task
   ending `1s   %% not yet official`). Docs examples are inputs users will
   paste, so decide tolerate-vs-error consciously against the family spec and
   put the decision in the ledger either way.
4. **Boundary semantics can differ while conservation laws agree** — gantt's
   exclude-walk counts `(start, end]` upstream vs our `[start, end)`. A
   property test of the conservation law plus a ledger entry for the boundary
   beats chasing instant-for-instant parity.
5. **The harvest finds seams, not just bugs**: the very first harvested gantt
   case exposed verify saying ok while render threw, which became the
   `UNRESOLVABLE_SCHEDULE` warning. When a harvested input behaves
   inconsistently across our own surfaces (parse vs verify vs render), that
   inconsistency is the finding.
6. **Upstream resolves more than you may assume** — their gantt resolver
   handles forward references; we had documented the opposite. The harvest
   corrects folklore about upstream as a side effect.

## Definition of done

- Every upstream test block accounted for (cases / exclusions / not-portable).
- All cases green; all executable exclusions green; bench README has
  provenance, fetch date, licenses, schema, and reason codes.
- Docs-corpus family entries + floors wired (`build-corpus.ts`,
  `agent-mermaid-corpus.test.ts`).
- Divergences that changed our behavior are reflected in the family's design
  doc and CHANGELOG.
