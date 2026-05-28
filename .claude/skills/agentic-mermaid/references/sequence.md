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

IMPORTANT — fidelity fallback: a sequence diagram that uses Note/alt/opt/par/
loop/activate/autonumber/multiline messages parses to an OPAQUE body. It still
parses, renders, verifies, and round-trips losslessly, but `asSequence` returns
null and structured mutation isn't offered. Edit `canonicalSource` as a string
for those. The parser never silently drops constructs.

Verify Tier 1 only (no layout engine): EMPTY_DIAGRAM, EDGE_MISANCHORED
(message references missing participant), LABEL_OVERFLOW (participant label or
message text over char cap).

Upstream: https://mermaid.js.org/syntax/sequenceDiagram.html
