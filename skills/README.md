# Agentic Mermaid skills

This folder contains the project’s agent skills in one agent-agnostic location. They are written as plain Markdown skill bundles so they can be loaded by Claude, Cursor, Pi, or any coding-agent harness that understands `SKILL.md` plus sibling references.

## Skills

| Skill | Purpose |
|---|---|
| [`agentic-mermaid-diagram-workflow`](./agentic-mermaid-diagram-workflow/SKILL.md) | Use Agentic Mermaid to author, edit, verify, serialize, and render Mermaid diagrams. Covers library, CLI, and MCP Code Mode workflows. |
| [`agentic-mermaid-live-editor-development`](./agentic-mermaid-live-editor/SKILL.md) | Modify the live editor implementation safely: source-of-truth files, generated artifacts, render pipeline, config UI, and export behavior. |

Agentic Mermaid outputs **ASCII, PNG, and SVG**. For PNG, agents should use `renderMermaidPNG(source, { fitTo, background })` from `agentic-mermaid/agent` or `am render diagram.mmd --format png --output diagram.png`. The diagram workflow skill emphasizes the agent-safe loop (`parse → narrow → mutate → verify → serialize`) and the live-editor skill explains how the editor exposes SVG/PNG exports while using the same renderer foundation.

## Why this folder exists

Older revisions split skills across `.claude/skills/` and `.agents/skills/`. Keeping them in `skills/` makes the repository’s guidance easier to find, package, evaluate, and reuse without making the skills specific to one coding agent.
