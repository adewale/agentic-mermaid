# ROUTE_SELF_CROSS

> ROUTE_SELF_CROSS is a geometric warning: a single edge’s routed polyline crosses over itself.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

A routing tripwire on the final geometry: the router avoids self-intersection, so a firing means dense cyclic routing degraded. The warning names the edge and the crossing count.

## How to fix it

Remove or redirect the redundant edge (`remove_edge`, then `add_edge` along a simpler path); a persistent self-cross on unchanged source is an engine bug to report.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_SELF_CROSS/
