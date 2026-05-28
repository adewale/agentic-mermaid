# Flowchart syntax (canonical Mermaid)

```
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]
  C --> D
```

## Directions

`TD` (top-down), `TB` (alias of TD), `LR` (left-right), `BT` (bottom-top), `RL` (right-left).

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
| `A -->|label| B` | labeled arrow |
| `A --o B` | open-circle marker |
| `A --x B` | cross marker |
| `A <--> B` | bidirectional |

## Subgraphs

```
flowchart TD
  subgraph Backend
    API --> DB[(Database)]
  end
  Client --> API
```

## MutationOp coverage

Flowchart and state diagrams support all six MutationOp kinds:

- `add_node`, `remove_node`, `rename_node`
- `set_label` (targets nodes or edges by `from->to` id)
- `add_edge`, `remove_edge` (edges identified as `from->to` or `from->to#N`)

`remove_node` cascades to delete all incident edges. `add_edge` implicit-declares missing endpoint nodes.

## Verification specifics

Tier 1 (structural, reliable):
- `EMPTY_DIAGRAM` — no nodes
- `EDGE_MISANCHORED` — edge references a node not in the graph
- `OFF_CANVAS` — laid-out node lies outside the canvas
- `GROUP_BREACH` (error) — a subgraph member node is positioned outside its subgraph's bounds
- `UNKNOWN_SHAPE` (warning) — shape name not in the known set

Tier 2 (metric, best-effort):
- `LABEL_OVERFLOW` (error) — label wider than the node's interior per the frozen font metrics; recall is low because ELK auto-pads generously
- `NODE_OVERLAP` (warning) — two laid-out nodes overlap
- `ROUTE_SELF_CROSS` (warning) — edge route crosses itself

## Other families

Sequence, class, ER, timeline, journey, xychart, architecture: parse and render via the existing Beautiful Mermaid pipeline. Mutation is not supported for these families in v1. For cross-cutting edits, operate on the diagram's `canonicalSource` as a string.

Upstream Mermaid syntax docs:

- Sequence: <https://mermaid.js.org/syntax/sequenceDiagram.html>
- Class: <https://mermaid.js.org/syntax/classDiagram.html>
- ER: <https://mermaid.js.org/syntax/entityRelationshipDiagram.html>
- State: <https://mermaid.js.org/syntax/stateDiagram.html>
- Timeline: <https://mermaid.js.org/syntax/timeline.html>
- Journey: <https://mermaid.js.org/syntax/userJourney.html>
- XY: <https://mermaid.js.org/syntax/xyChart.html>
- Architecture: <https://mermaid.js.org/syntax/architecture.html>
