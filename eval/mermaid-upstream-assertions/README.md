# Original pinned Mermaid assertions

This runner executes the original Mermaid 12.2.0 family test files and
`@mermaid-js/parser` family tests. It does not harvest source literals. Vitest
expands their loops, tagged templates and parameter tables, so dynamically built
inputs and their original expectations participate.

```sh
bun run reference:mermaid
bun run eval:mermaid-assertions
# Optional locations and subset:
bun run eval:mermaid-assertions --upstream ../mermaid --reference ../mermaid-reference --families er,sequence --out /tmp/mermaid-assertions
```

Node runs Vitest; Bun runs the coordinator. The source checkout must have the
exact policy pin and clean tracked files. The independently installed reference
must match Mermaid 12.2.0 and parser 2.0.1. The normal reference setup uses jsdom
26.1.0. Generated JSON, logs and the Markdown breakdown belong in the ignored
`results/` directory or the chosen output directory.

The existing semantic CI lane runs the same command and uploads the reports,
per-case receipts and runner logs in `modern-mermaid-semantic-results`.
Assertion failures remain diagnostic counts; provenance or runner execution
errors fail the CI step.

`inventory.ts` recursively inventories every `.spec`/`.test` JS/TS file in each
supported family's source directory, plus its parser-package test file when
present. Renderer and database-helper files are attempted too; they are not
silently excluded. The inventory scope is family suites, rather than all Mermaid
application, integration, browser or accessibility suites.

The Vite adapter changes **import declarations only** in those files and the
original parser test helper. Test bodies, data, assertions, snapshots and original
file locations are unchanged. The original test utilities execute unchanged.
Production parser/database imports receive either the independent pinned Mermaid
implementation (control run), or views of Agentic's real native parser models.
The native entry uses the public renderer's request normalization and actual
family parser. Views convert model schemas; they do not parse an alternative
Mermaid implementation or return fixture expectations. Source spelling is
restored only when it denotes the actual native value. Sequence inline activation
and central-connection fields expand into the pinned database event protocol,
and lifecycle indexes follow that expanded event list. Actor properties without
a native semantic model and renderer bookkeeping remain explicit adapter gaps.

Each case records its original name, file, actual input strings, admission result
and any unavailable API. An unavailable operation cannot pass accidentally when
an original negative assertion catches its exception: the after-case guard
records and fails that boundary. A case that never invokes a native parser is
also marked outside the adapted input-language boundary.

`report.json` and `report.md` show all registered cases by family and disjoint
cause:

- **Passed:** original assertion passes and the corresponding reference control
  passes without an adapter boundary.
- **Native refusal:** a reference-qualified failing assertion includes a rejected
  native input. Negative tests that correctly expect rejection can still pass.
- **Assertion mismatch:** a reference-qualified assertion fails without a native
  refusal or declared adapter boundary. This needs triage; schema/view differences
  and deliberate reader divergences are not automatically product defects.
- **Adapter unavailable:** missing production API or a direct database/helper or
  renderer-only case without a native parse. This is a coverage gap, never a pass.
- **Reference unqualified:** the control failed or did not collect. For example,
  jsdom cannot provide real browser SVG measurement for some renderer assertions.
- **Skipped:** upstream skipped, pending or todo cases.

Collection errors are listed separately with original paths. The runner produces
a report when assertions fail; missing result artifacts or incorrect provenance
are execution errors. A complete inventory attempt is not a claim that all
upstream APIs are implemented or all original assertions pass. The report keeps
coverage gaps visible instead of presenting sample acceptance as suite success.

For a controlled production-base comparison, `AM_ASSERT_NATIVE_ENTRY` may point
to a copy of `grammar-agentic.ts` in a clean base export. That copy is measurement
instrumentation; all production imports and parser observation use the base's
source. Normal runs leave this unset.
