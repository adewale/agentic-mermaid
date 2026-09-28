# Flowchart syntax

`flowchart TD|TB|LR|BT|RL`, then `A[label] --> B`.

Shapes: `[rect]` `(round)` `([stadium])` `[[subroutine]]` `[(cylinder)]`
`((circle))` `(((double)))` `>asymmetric]` `{diamond}` `{{hexagon}}`
`[/trapezoid\]` `[\trapezoid-alt/]`.

Edges: `-->` `---` `-.->` `==>` `--o` `--x` `<-->` `-->|label|`.

MutationOps: the live list and field shapes come from `am capabilities --json`
(`families[].mutationOps` / `opFields`) or `describeOps('flowchart')` — node,
edge, shape, direction, subgraph, and class/style ops. remove_node cascades to
incident edges; add_edge implicit-declares missing endpoints.

Verify Tier 1: EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH,
UNKNOWN_SHAPE, LABEL_OVERFLOW (char-cap, default 40).
Tier 2: NODE_OVERLAP, ROUTE_SELF_CROSS, ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND, ROUTE_LABEL_ON_SHARED_TRUNK, ROUTE_SELF_LOOP_OCCUPANCY, ROUTE_CONTAINER_MISANCHOR, ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE.
