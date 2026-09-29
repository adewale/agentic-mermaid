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

Verify: every Tier 1 code except the Gantt-only UNRESOLVABLE_SCHEDULE can fire
on a flowchart (LABEL_OVERFLOW caps a label line at 40 characters by default),
and so can every Tier 2 geometric code. `am capabilities --json` lists the codes
by tier (`warningCodes`); each code's page under
https://agentic-mermaid.dev/warnings/ says what triggers it and how to clear it.
