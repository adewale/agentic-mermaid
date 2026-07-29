# Agentic Mermaid hosted MCP privacy notice

Last updated: 2026-07-30

This notice covers the public Agentic Mermaid MCP endpoint at
`https://agentic-mermaid.dev/mcp`. It does not cover a local library, CLI, or
stdio MCP installation, where processing stays in the environment that runs
Agentic Mermaid.

## Data the hosted endpoint processes

The endpoint processes the MCP request body that a client sends. Depending on
the selected tool, that can include Mermaid source, render options, structured
edit operations, or JavaScript submitted to the isolated `execute` tool.

No Agentic Mermaid account is required. The hosted service does not ask for a
name, email address, or payment information.

The hosting platform also processes ordinary connection and operational data,
such as an IP address, request timing, response status, and error information,
to deliver, protect, and troubleshoot the service.

## How data is used

Request data is used only to perform the requested render, verification,
description, edit, build, or isolated execution and to operate and secure the
service. The `execute` sandbox has no network access.

Successful results from deterministic pure-compute tools may be reused in a
private server-side compute cache for up to 24 hours. `execute`, `mutate`, and
`build` bypass that cache. HTTP responses from `/mcp` carry `Cache-Control:
no-store`.

Do not submit secrets, personal data, confidential diagrams, or other sensitive
material to the public endpoint. Use the local library, CLI, or stdio MCP when
data must remain in your own environment.

## Sharing and retention

Agentic Mermaid does not make submitted diagrams public. Infrastructure
providers may process request and operational data on behalf of the service.
Private compute-cache entries expire within 24 hours. Operational records are
retained only as needed to run, protect, and troubleshoot the service.

## Your choices

You may avoid hosted processing entirely by installing `agentic-mermaid` and
using its library, CLI, or stdio MCP server locally. To ask a privacy question
or request help concerning hosted data, email
[adewale+mcp@gmail.com](mailto:adewale+mcp@gmail.com).

This notice may be updated when the hosted service or its data handling changes.
