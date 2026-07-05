# ROUTE_CONTAINER_MISANCHOR

> ROUTE_CONTAINER_MISANCHOR is a geometric warning: an edge attached to a subgraph or group does not terminate on the container’s border.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

Container-anchored edges must end exactly on the group rectangle; a miss means the border moved after routing. This is a tripwire over final geometry rather than a source mistake.

## How to fix it

Re-anchor the edge to a member node instead of the container as a workaround, and report the source — the container anchor contract is the engine’s to uphold.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/ROUTE_CONTAINER_MISANCHOR/
