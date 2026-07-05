# CONTENT_DROPPED_ON_ROUNDTRIP

> CONTENT_DROPPED_ON_ROUNDTRIP is a lint warning: a parse → serialize → re-parse cycle lost nodes, edges, or groups by count.

- **Tier:** lint
- **Severity:** warning

## What triggers it

A serializer defect on unusual syntax: the faithfulness tally before and after the round trip disagrees. This is a tripwire that guards every verify; it should not fire on supported syntax.

## How to fix it

Do not serialize the typed tree for this diagram — fall back to source-level edits so nothing is lost, and report the source; the before/after counts on the warning pinpoint what vanished.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/CONTENT_DROPPED_ON_ROUNDTRIP/
