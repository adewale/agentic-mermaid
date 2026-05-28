# Flowchart syntax (canonical Mermaid)

```
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]
  C --> D
```

## Directions

`TD` (top-down), `TB` (top-bottom, alias of TD), `LR` (left-right), `BT` (bottom-top), `RL` (right-left).

## Shapes

| Syntax | Shape |
|---|---|
| `A[text]` | rectangle (default) |
| `A(text)` | rounded |
| `A([text])` | stadium |
| `A[[text]]` | subroutine (double-bordered) |
| `A[(text)]` | cylinder (database) |
| `A((text))` | circle |
| `A(((text)))` | double circle |
| `A>text]` | asymmetric (flag) |
| `A{text}` | diamond (decision) |
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
| `A -->|label| B` | labeled arrow |

## Subgraphs (groups)

```
flowchart TD
  subgraph Backend
    API --> DB[(Database)]
  end
  Client --> API
```

## MutationOp coverage

In the agent surface, flowchart and state diagrams support all six MutationOp kinds:

- `add_node`, `remove_node`, `rename_node`
- `set_label` (targets nodes or edges by `from->to` id)
- `add_edge`, `remove_edge` (edges identified as `from->to` or `from->to#N`)

When an edge is removed, the nodes it referenced remain unless they become orphaned. `remove_node` cascades to delete all incident edges.

## Verification specifics for flowcharts

The verifier catches:
- `EMPTY_DIAGRAM` — no nodes
- `EDGE_MISANCHORED` — edge references a node not in the graph (shouldn't happen via `mutate` since edge endpoints implicit-declare; can happen with hand-written source)
- `LABEL_OVERFLOW` — node label is wider than its bounding box
- `OFF_CANVAS` — laid-out node is outside the canvas
- `NODE_OVERLAP` (warning) — two laid-out nodes overlap
- `GROUP_BREACH` (error) — a subgraph member node is positioned outside its subgraph's bounds
- `UNKNOWN_SHAPE` (warning) — shape name not in the known set
