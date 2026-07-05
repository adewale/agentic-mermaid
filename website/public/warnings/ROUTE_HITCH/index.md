# ROUTE_HITCH

> ROUTE_HITCH is a geometric warning: an edge deviates from its certified straight lane by more than the tolerance, reported in pixels.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

The layout certifies clear lanes when routes are frozen; a hitch means a later pass mutated geometry after certification. Agents cannot cause this from source alone.

## How to fix it

Simplify the crossing edges near the named edge if a quick fix is needed, and report the reproducing source — the certificate/geometry mismatch is an engine defect.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_HITCH/
