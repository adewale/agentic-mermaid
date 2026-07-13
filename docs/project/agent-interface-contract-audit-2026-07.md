# Agent-interface contract audit — July 2026

This is the provenance and prevention record for PR
[#162](https://github.com/adewale/agentic-mermaid/pull/162). It records where
the audited defects entered, which later changes exposed or reinforced them,
why the existing suite stayed green, and the recurrence controls added by the
fix. A commit named below is the first relevant implementation or the change
that created the bad interaction; it is not an attribution of intent.

## What entered when

| Contract failure | First relevant change | Failure mechanism |
|---|---|---|
| Public “edge-cached” claim did not match `cache-control: no-store` | [`5a59126`](https://github.com/adewale/agentic-mermaid/commit/5a59126ce4290c548d9840b9f9ebd10682bce618), hosted MCP #94 | One phrase conflated a private Workers Cache API memo with an HTTP/CDN cache. The transport intentionally emitted `no-store`; there was no public cache-status header. |
| Sequence `alt`/`loop`/`opt`/`par` messages disappeared from read-back | [`2189e15`](https://github.com/adewale/agentic-mermaid/commit/2189e15b34dbe3a221599eea7ebb63fe9cff59ca), then [`09fa5ab`](https://github.com/adewale/agentic-mermaid/commit/09fa5ab5911de4f8261add9ecf28ee04d2b5471d) | `describe` read only the global `body.messages`. BUILD-18 later preserved fragments as opaque blocks but did not update describe/facts or add a warning. Layout independently parsed the source, so its edge count disagreed without failing. |
| Tolerant parser repairs were silent | family parser work, especially XYChart [`61a51ca`](https://github.com/adewale/agentic-mermaid/commit/61a51ca69977072890427f3c1dd7e0d85798de87) and flowchart tolerance work | Verification checked the resulting model but had no invariant requiring every lossy repair, inferred entity, or accepted shape mismatch to emit a diagnostic. “Parses and renders” was treated as sufficient evidence. |
| Hosted `describe.ok` contradicted `verify` | [`f9ef5c2`](https://github.com/adewale/agentic-mermaid/commit/f9ef5c2b8a668eeaceb85cac844936ba002cc726) | Text/facts/tree paths hardcoded `ok:true` after parsing and never ran the renderability gate used by `verify`. |
| ER `build` duplicated the first entity | statement preservation in [`8f3297b`](https://github.com/adewale/agentic-mermaid/commit/8f3297b5ddbb305c7d06a67108adc93d37b1509e) | `add_entity` pushed the entity before lazily materializing the order ledger. Materialization included the new entity, then the mutation appended it again. |
| JSON-RPC numeric ids lost lexical precision | local HTTP [`4748073`](https://github.com/adewale/agentic-mermaid/commit/47480732a71215a62520fe53bac2683e8ee35bb7), hosted HTTP [`5a59126`](https://github.com/adewale/agentic-mermaid/commit/5a59126ce4290c548d9840b9f9ebd10682bce618) | Every transport parsed ids through JavaScript `Number`. Envelope validation tested type/shape, not correlation-token byte preservation. |
| Code Mode rejected safe `${` text and did not reliably accept statement bodies | [`5a59126`](https://github.com/adewale/agentic-mermaid/commit/5a59126ce4290c548d9840b9f9ebd10682bce618) | A source-text prefilter approximated JavaScript lexical structure. It treated template markers in strings/comments as executable and did not understand regex literals; expression-first wrapping made statement fallback an integration concern. |
| Header aliases were inconsistent | Architecture [`8e04814`](https://github.com/adewale/agentic-mermaid/commit/8e04814280283aea57268163b6b71d4ec2ffbb1a), XYChart [`61a51ca`](https://github.com/adewale/agentic-mermaid/commit/61a51ca69977072890427f3c1dd7e0d85798de87), Quadrant [`213601c`](https://github.com/adewale/agentic-mermaid/commit/213601cbae19c7934c9440fb9f881e4fd0d13ea1) | Each family owned a separate header regex. XYChart accepted both spellings while Architecture and Quadrant required one literal spelling and silently fell back to opaque. |
| Unknown Architecture icons were not named | Architecture registration [`8e04814`](https://github.com/adewale/agentic-mermaid/commit/8e04814280283aea57268163b6b71d4ec2ffbb1a) | Icon diagnostics ran only for structured bodies. Any unrelated construct that selected the opaque fallback also disabled icon verification. |
| Batch `ascii:true` emitted Unicode | batch renderer [`5e8ac53`](https://github.com/adewale/agentic-mermaid/commit/5e8ac53d0cb179a06eef45c11691a42917de9832) | The batch branch called the renderer default instead of explicitly setting `useAscii:true`; tests checked the field name, not the 7-bit output invariant. |
| Timeout values at or below zero became a 1 ms budget | local HTTP [`4748073`](https://github.com/adewale/agentic-mermaid/commit/47480732a71215a62520fe53bac2683e8ee35bb7), hosted MCP [`5a59126`](https://github.com/adewale/agentic-mermaid/commit/5a59126ce4290c548d9840b9f9ebd10682bce618) | Runtime code clamped before rejecting; the schema and two implementations did not share one positive-integer validator. |
| Fresh source checkouts crashed before printing a remedy | CLI entrypoint refactors [`055d4ff`](https://github.com/adewale/agentic-mermaid/commit/055d4ff088944b227d2be66380170e65c21375e7d) and [`01a5af7`](https://github.com/adewale/agentic-mermaid/commit/01a5af702069d6affad920c5d96c9ef78e8ce93f) | Top-level imports resolved third-party modules before command code could format a dependency error. A helper-unit test did not execute either real source entrypoint, and Bun auto-install masked fresh-checkout behavior unless explicitly disabled. |
| Catalog/tool/warning examples drifted | multiple hand-maintained website inventories, beginning with the agent-first site | Tests asserted selected members and absence of old files rather than ordered exact equality with the runtime registries or existence of every linked resource. |

The remaining low-severity findings had the same shapes: the 405 response had
no exact HTTP-header assertion; execute error tests accepted leaked stack
suffixes; a capability example was checked for presence rather than for firing;
warning codes were inventoried without executable witnesses; and flowchart edge
metadata passed through a parser path whose node-extraction side effect was not
asserted.

## Review of PRs #157 and #160

### PR #157 — progressive SDK discovery

[#157](https://github.com/adewale/agentic-mermaid/pull/157), commit
[`d8fcb07`](https://github.com/adewale/agentic-mermaid/commit/d8fcb07a6f2b4fa061e342a6a3fb8c14ebee55da),
did not introduce the parser, describe, JSON-number, Code Mode, or ASCII
defects. It did introduce two adjacent inventory/cache gaps:

- `describe_sdk` became the ninth hosted tool, but root `llms.txt` was not in
  the changed-file set and no exact registry-to-document assertion failed;
- its private cache key normalized arguments before dispatch. That repeated the
  existing design assumption that cache-key equivalence could be decided
  safely before validation.

The PR's token and behavior evals were appropriate for its stated discovery
goal, but they were not a surface-inventory proof. “Tools list contains the new
tool” and “every published agent inventory equals tools/list” are different
contracts.

### PR #160 — editor and MCP boundary hardening

[#160](https://github.com/adewale/agentic-mermaid/pull/160), commit
[`ffc69f5`](https://github.com/adewale/agentic-mermaid/commit/ffc69f5183e689d499e39f28a95e45d10b3b44e0),
fixed real security and protocol defects. It did not originate most findings in
this audit, but it touched three affected seams without detecting their wider
contracts:

- it edited the generated MCP documentation to include `describe_sdk` while
  carrying the pre-existing “edge-cached” wording forward;
- it expanded JSON-RPC envelope tests, but tested value/type behavior after
  `JSON.parse`, not exact numeric-id correlation across the wire;
- it made deployed provenance use `SITE_GIT_SHA` or local `HEAD`, but trusted an
  explicit SHA without proving it matched a clean checkout. Its test used the
  ordinary current worktree only, so dirty and mismatched builds were absent.

It also added socket-boundary cases through a pre-existing helper that returned
`null` on bind denial; each caller then returned from the test. The test suite
therefore reported success when the asserted transport never started. This is
the clearest example of why test count and assertion count did not measure the
honesty of the boundary evidence.

## Adjacent defects found during this audit

The reproduction work found and fixed issues beyond the original report:

- `execute` results were privately cached even though the sandbox exposes
  `Date` and `Math.random`, freezing the first result for a day;
- normalized pre-dispatch cache keys could let a warm valid response mask a
  later request with invalid or different raw arguments;
- cache-ineligible `execute` calls were reported as cache `miss` rather than
  `bypass`, and `describe_sdk` remained the lone normalized key after the first
  cache correction;
- unsafe decimal and exponent JSON-RPC ids, local stdio/HTTP/SSE ids, and
  installed-package stdio ids had the same precision/lexeme problem as the
  reported hosted integer case;
- local HTTP request assembly could corrupt a UTF-8 code point split across
  stream chunks;
- local SSE advertised an internal bind URL instead of the configured public
  proxy origin;
- explicit build provenance could describe a dirty or different checkout;
- workflow installs were not uniformly frozen, and the nightly lane differed
  from CI/release/deploy;
- generated AI resource inventories were partial rather than exact and one
  indexed warnings target did not exist.

The independent multi-agent review of the completed first pass found another
set of boundary counterexamples before publication:

- sequence prose grouped every top-level message before every fragment, so a
  message-fragment-message source lost chronological order even though facts
  and layout were correct;
- endpoint-typo diagnostics missed nodes declared with v11 `id@{...}` metadata
  or the asymmetric `id>label]` shape;
- the repaired hand-written JavaScript slash scanner still confused division
  and regex literals after postfix/control-flow tokens. One form hid a dynamic
  `import()` or banned global from the pre-screen; the opposite form rejected a
  valid regex literal;
- same-host Origin validation ignored the URL scheme, while HTTP content-type
  checks accepted `application/jsonp` and malformed suffixes;
- the exact-id codec still canonicalized numeric `-0` to `0`;
- the website test preload fingerprint ignored Git HEAD/status even though
  generated provenance depends on both, allowing stale artifacts after a
  commit;
- the first “exact” inventory assertion filtered unknown names and deduplicated
  them, recreating a positive-subset test under a stronger label;
- advertised warning examples and maintained cache prose had current witnesses
  but no all-surface recurrence gate.

## Why the suite missed the cluster

The defects were distributed, but the testing failure was systemic:

1. **No boundary-contract matrix.** Unit, parser, website, MCP, and generated
   artifact tests were extensive but independently scoped. No test enumerated
   one claim across runtime, transport, initialize instructions, docs, and
   catalogs.
2. **Assertions were positive subsets.** “Contains this tool/code/example” let
   omissions, duplicates, extra items, and dead examples pass. Exact ordered
   equality and target existence were missing.
3. **The oracle reused the implementation's abstraction.** Sequence read-back
   tests counted `body.messages`, cache tests asserted the chosen normalized
   keys, and ASCII batch tests trusted the `ascii` field. None used the external
   semantic or byte-level contract.
4. **Negative space was under-sampled.** Invalid budgets, warm-cache collisions,
   unknown icons under opaque fallback, reverse XY mismatches, decimal/exponent
   ids, nested JSON ids, and strings/comments/regex literals were not in the
   equivalence classes.
5. **Helpers substituted for shipped boundaries.** Dependency formatting and
   protocol helpers passed while the source bins, installed tarball, sockets,
   proxy URL, and chunked byte stream were untested or vacuously skipped.
6. **Repair and observability were decoupled.** The tolerant parsers had no
   mechanical rule saying that every dropped, inferred, or unmodeled semantic
   must produce a warning.
7. **Large green totals obscured proof quality.** Thousands of render/layout
   cases did not exercise JSON lexemes, cache validation ordering, deployment
   provenance, or generated-resource completeness.
8. **Hand-written lexical approximations were treated as validators.** Prefix
   checks for media types and slash-state guesses for JavaScript appeared
   exhaustive in example tests but did not implement the underlying grammars.
9. **Test infrastructure had unmodeled inputs.** The generated-site cache keyed
   source bytes but not Git state, so the fixture itself could serve evidence
   for a different provenance state.

## Recurrence controls applied

The audit used the trust-boundary, walking-skeleton, property-testing,
fault-injection, documentation-sync, mutation, and correctness-by-construction
techniques in
[`adewale/testing-best-practices`](https://github.com/adewale/testing-best-practices).
They produced implementation changes rather than an additional checklist:

- one exact JSON-RPC id codec is shared by hosted HTTP, local HTTP/SSE, and
  stdio, with properties over integer/decimal/exponent lexemes, batches, nested
  data, negative zero, sentinel collisions, and arbitrary malformed input;
- Code Mode uses a real ECMAScript parser/AST walk for forbidden executable
  constructs; regex, division, postfix operators, templates, comments, and
  dynamic import are covered as differential classes rather than slash guesses;
- HTTP boundaries validate the full same-origin tuple and an exact JSON media
  type grammar instead of comparing only hosts or string prefixes;
- one positive-safe-integer timeout validator is shared by tool schema and both
  runtimes;
- one branch-aware sequence message-context model feeds prose, facts, AX-tree,
  layout, and typed fragment edits; prose walks the ordered statement ledger
  instead of regrouping messages and fragments;
- cache eligibility is explicit, non-idempotent tools bypass, and cacheable
  calls retain complete raw arguments before dispatch;
- real source-checkout and installed-tarball walking skeletons exercise the
  bins, with Bun auto-install disabled for the missing-dependency case;
- socket tests fail rather than return, and byte/proxy tests use the real stream;
- agent resources and tool inventories derive from canonical registries and are
  checked for exact order, uniqueness, unknown names, and existing targets;
- dirty/mismatched build provenance is rejected, and every CI/release/deploy
  install uses the lockfile as a gate; generated-test fingerprints include the
  same Git HEAD/status inputs as provenance;
- every advertised warning example must fire its own code during the build,
  and cache prose is checked across maintained and generated discovery surfaces;
- each reported repair has a named regression assertion, while source-preserved
  sequence semantics that remain unmodeled emit `UNSUPPORTED_SYNTAX`.

The durable rule is: for every public contract, identify the lowest honest
oracle and the shipped boundary that can change it. Require both. A helper test,
selected-subset assertion, or silently skipped environment is not evidence for
that contract.
