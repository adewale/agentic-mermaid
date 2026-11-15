# Pinned Kanban harvest

Source: Mermaid **12.2.0**, commit `1fb7869866dd619168d840291c9c54b4f129758b` (MIT), inspected 2026-10-19. `provenance.json` records original source-file hashes and paths. The 44 cases preserve original inputs and assertions, with expectations obtained from the isolated official Mermaid reference.

The harvest accounts for all **30** blocks in `packages/mermaid/src/diagrams/kanban/kanban.spec.ts`, all **11** checked-in rendering `.mmd` inputs, and all **3** syntax-page fences. It covers indentation, deep card indentation, malformed outdents, explicit/implicit IDs, alternate node delimiters, quoted labels, classes, icons, blank rows/comments, metadata in both YAML forms, metadata label overrides, priorities, assignments and tickets. The runner compares column/card order, parentage, labels and every asserted metadata field; it checks canonical stability and the public renderer. No portable parser/semantic case is excluded.

Additional tests protect collision-free occurrence identities for duplicated authored IDs (including the duplicate `id3` in Mermaid's full documentation example), lossless ordered moves, nonempty-column deletion checks, multiline card geometry, metadata wrapping, Unicode/ASCII, wrapper retention and generated round trips with delimiter-bearing text. Source IDs are retained separately from public occurrence IDs.

Ticket navigation is represented by the same safe inert `data-href`/link semantics as Agentic Mermaid's existing class diagrams; strict hosting emits ticket text without navigation. No network, DOM, script or icon-font dependency is required. Icons use an explicit visible name when no native symbol is available, preserving the authored identity offline. Priority text remains readable across palettes rather than relying on color alone.

Regenerate using the commands in `../mermaid-packet-bench/README.md`, then run:

```bash
bun test src/__tests__/kanban-upstream-bench.test.ts src/__tests__/kanban-family.test.ts
```

The separate modern-grammar mutation run (100 mutations, seed 7) found five reference-only inputs: one corrupted header admitted only by forced grammar selection, and four malformed delimiter/outdent combinations that Mermaid's lazy parent resolution accepts. `divergences.json` retains all five full generated sources and rejection reasons. Agentic rejects these corruptions explicitly. The complete pinned parser/semantic corpus and documentation sources remain admitted and tested.
