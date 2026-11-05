---
name: agentic-mermaid-diagram-workflow
description: Create, edit, verify or render Mermaid diagrams with Agentic Mermaid. Read the operating guide, choose one available library, CLI or MCP channel, then use version-matched discovery for typed operations.
---

# Agentic Mermaid — diagram workflow

Read the operating guide before diagram work:

- Installed CLI: `am --agent-instructions` (or `npx agentic-mermaid --agent-instructions`).
- This repository: `Instructions_for_agents.md` at the repository root.
- An `am init-agent` installation includes an offline copy at
  `references/operating-guide.md` beside this skill.
- Without a local installation: [hosted operating guide](https://agentic-mermaid.dev/agent-instructions.md).

Follow the installed or connected version's guide and discovery. The online
guide describes production, which can differ from an older package. Choose
one channel and keep the diagram's source in the authorized environment.

Load only the relevant channel reference for exact call shapes:

- [Code Mode](references/code-mode.md): synchronous `mermaid.*` SDK calls.
- [CLI](references/cli.md): shell commands and output files.
- [Hosted MCP](references/hosted-mcp.md): direct tools, JSON-RPC and request examples.

The operating guide owns authoring, typed edits, verification, semantic
read-back, source-preserving fallback and response rules. References add
channel and family syntax; they do not define a second workflow. Discover
family headers and operations with `am capabilities --json` or `describe_sdk`
rather than borrowing another family's vocabulary.
