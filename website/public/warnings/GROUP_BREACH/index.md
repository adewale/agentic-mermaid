# GROUP_BREACH

> GROUP_BREACH is a structural error: a node that belongs to a subgraph or group is positioned outside its group rectangle.

- **Tier:** structural
- **Severity:** error

## What triggers it

An engine-bug tripwire like `OFF_CANVAS`: deeply nested subgraphs combined with cross-group edges are historically where containment slipped. The warning names both the group and the escaping member.

## How to fix it

Flatten the nesting or move the member out of the group (source edit, or `remove_node` then re-add outside the subgraph). A reproducible breach is a renderer bug worth reporting with the source.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/GROUP_BREACH/
