# Flowchart syntax

```
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]
```

## Directions
`TD` / `TB` / `LR` / `BT` / `RL`.

## Shapes

| Syntax | Shape |
|---|---|
| `A[text]` | rectangle (default) |
| `A(text)` | rounded |
| `A([text])` | stadium |
| `A[[text]]` | subroutine |
| `A[(text)]` | cylinder |
| `A((text))` | circle |
| `A(((text)))` | double circle |
| `A>text]` | asymmetric |
| `A{text}` | diamond |
| `A{{text}}` | hexagon |
| `A[/text\]` | trapezoid |
| `A[\text/]` | trapezoid alt |

## Edges

| Syntax | Style |
|---|---|
| `A --> B` | solid arrow |
| `A --- B` | solid line, no arrow |
| `A -.-> B` | dotted arrow |
| `A ==> B` | thick arrow |
| `A --o B` / `A --x B` | circle / cross marker |
| `A <--> B` | bidirectional |
| `A -->\|label\| B` | labeled |

## MutationOp coverage (6)

`add_node`, `remove_node`, `rename_node`, `set_label`, `add_edge`, `remove_edge`.

## Verification

Tier 1: `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW` (char-cap; default 40).
Tier 2: `NODE_OVERLAP`, `ROUTE_SELF_CROSS`.
