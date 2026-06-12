# Flowchart syntax

`flowchart TD|TB|LR|BT|RL`, then `A[label] --> B`.

Shapes: `[rect]` `(round)` `([stadium])` `[[subroutine]]` `[(cylinder)]`
`((circle))` `(((double)))` `>asymmetric]` `{diamond}` `{{hexagon}}`
`[/trapezoid\]` `[\trapezoid-alt/]`.

Edges: `-->` `---` `-.->` `==>` `--o` `--x` `<-->` `-->|label|`.

MutationOps (6): add_node, remove_node, rename_node, set_label, add_edge,
remove_edge. remove_node cascades to incident edges; add_edge implicit-declares
missing endpoints.

Verify Tier 1: EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH,
UNKNOWN_SHAPE, LABEL_OVERFLOW (char-cap, default 40).
Tier 2: NODE_OVERLAP, ROUTE_SELF_CROSS, ROUTE_HITCH.
