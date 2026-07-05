# NODE_OVERLAP

> NODE_OVERLAP is a geometric warning: two nodes’ boxes intersect in the final layout; the warning reports the pair and the overlap area in pixels.

- **Tier:** geometric
- **Severity:** warning

## What triggers it

The deterministic layout separates nodes by construction, so no small flowchart source fires this — it appears only when a family adapter or post-pass produces colliding boxes on dense inputs. It is a tripwire, not an everyday lint.

## How to fix it

Shorten the labels of the named pair or reduce local density; if the overlap persists on a stable input, treat it as a layout defect and report the source.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/NODE_OVERLAP/
