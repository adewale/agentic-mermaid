# Start an Agentic Mermaid task

Read the [operating guide](/agent-instructions.md), then use one available
channel to complete the task. This page is an entry point; the operating rules
are maintained in that guide and are also available from
`am --agent-instructions`.

Choose a channel once:

- **Installed package or shell:** use its guide and `am capabilities --json`;
  installed declarations and command help match that version.
- **Connected MCP:** inspect its tool list and use `describe_sdk` for unfamiliar
  fields. Follow the guide's distinction between local and hosted tools.
- **Network only:** the guide explains the hosted endpoint at
  `https://agentic-mermaid.dev/mcp`. Send source there only when authorized.

The online guide describes the deployed version. For a local installation,
prefer its installed guide and discovery. With `am init-agent`, the operating
guide is available offline in the installed skill's `references/operating-guide.md`.
