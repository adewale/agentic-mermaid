# Sequence diagram syntax

```
sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hi
  Bob-->>Alice: Hello
```

## Participants

| Syntax | Effect |
|---|---|
| `participant A` | declare with id and label = `A` |
| `participant A as Label` | declare with label `Label` |
| `actor A` / `actor A as Label` | actor (stick-figure) variant |

Participants are also declared implicitly by their first message reference.

## Message arrows

| Arrow | Style |
|---|---|
| `->>` | sync request (solid + filled head) |
| `-->>` | reply (dashed + filled head) |
| `->` | async (solid, no head) |
| `-->` | async-dashed |
| `-x` | lost (solid + X) |
| `--x` | lost-dashed |

## MutationOp coverage (5)

`add_participant`, `remove_participant` (cascades — drops messages referencing the removed participant), `add_message`, `remove_message` (by index), `set_message_text` (by index).

## Verification

Tier 1 only — sequence diagrams don't use the layout engine:
- `EMPTY_DIAGRAM` — no participants and no messages
- `EDGE_MISANCHORED` — message references a participant that doesn't exist
- `LABEL_OVERFLOW` — participant label or message text exceeds char cap

`OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `NODE_OVERLAP`, `ROUTE_SELF_CROSS` do not apply to sequence diagrams.

## Upstream syntax reference
<https://mermaid.js.org/syntax/sequenceDiagram.html>
