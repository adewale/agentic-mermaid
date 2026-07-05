# EMPTY_DIAGRAM

> EMPTY_DIAGRAM is a structural error: the source parses to a diagram with no drawable content.

- **Tier:** structural
- **Severity:** error

## What triggers it

A bare header like `flowchart TD` with no statements after it, a body containing only comments, or a mutation sequence that removed the last node, message, or task.

## How to fix it

Add at least one element — `add_node`/`add_edge` for flowcharts, `add_participant`/`add_message` for sequence, `add_task` for gantt/journey — or check that the intended body was not lost before serializing.

## Example

```mermaid
flowchart TD
```

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/EMPTY_DIAGRAM/
