# ROUTE_STALE_AFTER_NODE_MOVE

> ROUTE_STALE_AFTER_NODE_MOVE is a geometric warning: an edge still follows a corridor computed before its node moved, so it anchors where the node used to be.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

A compaction or alignment pass moved a node after edge routing without re-anchoring the affected edges. Not producible from source alone in normal operation.

## How to fix it

No diagram edit reliably clears it; report the reproducing source. If it blocks a task, removing and re-adding the named edge forces a fresh route.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_STALE_AFTER_NODE_MOVE/
