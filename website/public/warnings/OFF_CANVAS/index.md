# OFF_CANVAS

> OFF_CANVAS is a structural error: a positioned node extends past the computed canvas on the reported axis.

- **Tier:** structural
- **Severity:** error

## What triggers it

Never in normal operation — the engine sizes the canvas around content, so this is a tripwire that fires only when a layout pass moves geometry after the canvas was sized. Layout is deterministic, so a firing input reproduces byte-identically.

## How to fix it

Not fixable by editing the diagram content itself: simplify or remove the construct that provokes it, and report the source as a renderer bug so the layout defect gets fixed.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/OFF_CANVAS/
