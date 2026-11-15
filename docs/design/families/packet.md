# Packet

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/packet.md)
and [domain reference](https://en.wikipedia.org/wiki/Packet_diagram) define the recognizable hallmark: A packet displays bit-addressed fields with proportional widths and explicit word rows.

## Semantics and editing

Fields retain absolute bit offsets, labels and ordering. Explicit ranges and relative bit counts are modeled; labels on split field pieces belong to the original field. Typed width/order edits recalculate contiguous offsets. Both packet and packet-beta are accepted; writers prefer packet.

Use `asPacket` after parsing and `describeOps('packet')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

The native placement algorithm splits ranges at bitsPerRow and retains field ownership through prepared text and rectangular Scene parts. Ascending and descending bitOrder mirror each row independently. Terminal placement computes its own cell tracks, rather than scaling SVG coordinates.

SVG fragments expose their field identity, semantic label and inclusive bit range. The Editor offers a native field selector and keyboard inspection: selecting one field highlights all its row fragments and reports bit length, inclusive bit range and zero-based byte offsets. This changes only the preview; canonical SVG exports retain their styles and geometry. No additional field-description syntax is introduced.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.

## Executable evidence

The complete primary TCP example is retained in packet-demo.mmd. The exact-pin upstream bench, field-width invariants, typed-edit tests and cross-surface checks protect field meaning.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/packet-demo.mmd --format svg --output /tmp/packet-demo.svg
bun run bin/am.ts render docs/design/families/packet-demo.mmd --format png --output /tmp/packet-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Upstream #8250, included in the pin, mirrors complete and partial rows for descending numbering while keeping authored ranges ascending. Open hand-drawn/endianness proposals are not a reason to change pinned syntax. https://github.com/mermaid-js/mermaid/pull/8250

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
