# Sequence diagram syntax

```
sequenceDiagram
  participant Alice
  actor Bob
  Alice->>Bob: Hi
  Bob-->>Alice: Hello
```

Participants: `participant A`, `participant A as Label`, `actor A`. Also declared
implicitly by first message reference.

Arrows → style: `->>` sync, `-->>` reply, `->` async, `-->` async-dashed,
`-x` lost, `--x` lost-dashed.

MutationOps (5): add_participant, remove_participant (cascades to messages),
add_message (implicit participants), remove_message (by index),
set_message_text (by index).

IMPORTANT — segment-preserving fidelity (BUILD-18): a sequence diagram that uses
Note/alt/opt/par/loop/critical/break/rect/activate/autonumber/title parses to a
STRUCTURED body that keeps your participant/message ops live. The unmodeled lines
ride along VERBATIM as opaque-block segments, so `asSequence` is non-null and you
can add_message / set_message_text / remove_message as usual. Two rules: (1)
`remove_message`/`set_message_text` indexes address only TOP-LEVEL messages —
messages inside an alt/loop block are part of the verbatim segment and are never
touched; (2) only an un-segmentable diagram (a stray `end`, an unclosed block)
falls back to a whole-body OPAQUE body where `asSequence` returns null — for those,
edit the preserved `body.source` intentionally, then re-parse and verify. Either
way the round-trip is lossless and the parser never silently drops constructs.

Verify Tier 1 only (no layout engine): EMPTY_DIAGRAM, EDGE_MISANCHORED
(message references missing participant), LABEL_OVERFLOW (participant label or
message text over char cap).

Upstream: https://mermaid.js.org/syntax/sequenceDiagram.html
