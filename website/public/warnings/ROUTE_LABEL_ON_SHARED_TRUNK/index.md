# ROUTE_LABEL_ON_SHARED_TRUNK

> ROUTE_LABEL_ON_SHARED_TRUNK is a geometric warning: an edge label sits on a line segment shared with another edge, so it is ambiguous which edge it names.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

Fan-in/fan-out patterns where several labeled edges merge onto a shared trunk and a label pill lands on the shared piece rather than the edge’s own segment.

## How to fix it

Shorten the label with `set_label` so it fits the edge’s exclusive segment, or restructure the fan so the labeled edge has its own approach.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_LABEL_ON_SHARED_TRUNK/
