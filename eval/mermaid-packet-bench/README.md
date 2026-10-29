# Pinned Packet harvest

Source: Mermaid **12.2.0**, commit `1fb7869866dd619168d840291c9c54b4f129758b` (MIT), inspected 2026-10-19. `provenance.json` binds source-file hashes and original paths. `cases.json` preserves every harvested input and original semantic-test assertion, alongside the independently recorded official Mermaid response.

Accounting:

- `packages/mermaid/src/diagrams/packet/packet.spec.ts`: all **15** test blocks, including all seven negative cases.
- `packages/parser/tests/packet.test.ts`: its one table block, all **8** header/whitespace rows.
- All **6** packet rendering `.mmd` inputs and all **4** Mermaid syntax-page fences.
- `packages/mermaid/src/diagrams/packet/renderer.spec.ts`: all **10** blocks (11 executions, including `showBits` for both orders) accounted as renderer-adapter tests. Mermaid DOM selectors, classes and exact pixel constants are implementation-specific. Their portable assertions—default/explicit ascending equivalence; field order; widths preserved under mirroring; inclusive bit labels; single-bit centering; independent row mirroring; right-aligned partial final words; and hidden bit labels—are exercised directly by `packet-family.test.ts`. No Mermaid pixel values are adopted as Agentic Mermaid requirements.

The runner checks title/accessibility, every row's inclusive start/end and label, negative-case rejection, canonical serialization stability and public SVG admission. Generated tests independently assert exact bit coverage across arbitrary row cuts and safe contiguous mutations. Native terminal tests cover the mirrored word diagram, Unicode/ASCII, titles and public structured edits.

One internal metadata difference is recorded in `divergences.json`: upstream's split blocks contain an off-by-one `bits` property. This does not alter their start/end or drawing. Our model keeps whole authored fields and computes each rendered segment's count from `end - start + 1`; the conservation assertion protects that behavior. No portable source case is excluded.

Regenerate from a clean pinned checkout and independent installed reference:

```bash
node eval/mermaid-packet-bench/harvest.mjs --inputs
node eval/mermaid-modern-compat/reference-worker.mjs ../mermaid-reference < /tmp/mermaid-packet-reference-input.jsonl > /tmp/mermaid-packet-reference-output.jsonl
node eval/mermaid-modern-compat/reference-worker.mjs ../mermaid-reference < /tmp/mermaid-kanban-reference-input.jsonl > /tmp/mermaid-kanban-reference-output.jsonl
node eval/mermaid-packet-bench/harvest.mjs
bun test src/__tests__/packet-upstream-bench.test.ts src/__tests__/packet-family.test.ts
```

The reference runs in Node/jsdom, separate from Agentic Mermaid and without a sanitizer shim. Reference DB getters do not retain frontmatter titles; the runner compares native body titles and the independent public-output test checks the envelope title's actual presence.
