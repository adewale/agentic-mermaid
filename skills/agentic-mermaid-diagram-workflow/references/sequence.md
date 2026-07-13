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

MutationOps include participant/top-level message edits plus `add_fragment`,
`remove_fragment`, fragment/branch label edits, and fragment-message add/remove/
text edits.

IMPORTANT — segment-preserving fidelity: `alt`, `opt`, `loop`, and `par` are
typed fragments. Their messages appear in describe/facts/verify and fragment
ops can author or edit them. Other constructs (Note/critical/break/rect/box/
activate/autonumber/title) ride along VERBATIM as opaque-block segments while
participant and top-level message ops remain live. Only an un-segmentable
diagram (a stray `end`, an unclosed block) falls back to a whole-body OPAQUE
body. Either way the parser never silently drops constructs.

Verify Tier 1 only (no layout engine): EMPTY_DIAGRAM, EDGE_MISANCHORED
(message references missing participant), LABEL_OVERFLOW (participant label or
message text over char cap).

Upstream: https://mermaid.js.org/syntax/sequenceDiagram.html
