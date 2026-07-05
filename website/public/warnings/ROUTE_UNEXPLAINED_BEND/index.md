# ROUTE_UNEXPLAINED_BEND

> ROUTE_UNEXPLAINED_BEND is a geometric warning: an orthogonally-routed edge contains a bend its route certificate does not explain.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

Orthogonal families (class, ER) certify every bend against an obstacle; an unexplained bend means post-certification geometry drift. Not reachable from well-formed source in normal operation.

## How to fix it

No source-level fix is expected to be needed; if verify reports it, capture the source and report it as a renderer bug — determinism makes the reproduction exact.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_UNEXPLAINED_BEND/
