# ROUTE_SHAPE_MISANCHOR

> ROUTE_SHAPE_MISANCHOR is a geometric warning: an edge endpoint does not sit on the outline of the node shape it connects to (e.g. off a diamond’s facet).

- **Tier:** geometric
- **Severity:** warning

## What triggers it

Endpoint-on-shape is checked against the final node geometry; a miss usually accompanies a node that changed size or shape after routes were frozen.

## How to fix it

Switching the node to a simpler shape (rectangle) is the mechanical workaround; the underlying anchor drift is an engine defect worth reporting with the source.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_SHAPE_MISANCHOR/
