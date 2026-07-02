# Agentic Mermaid website

Cloudflare Workers Static Assets site for `agenticmermaid.dev`, generated from website-owned source files and aligned to the website spec in PR #27.

## Shape

- `source/` — website-owned source pages, assets, and diagram seeds.
- `public/` — built static assets served by Cloudflare's asset binding.
- `src/worker.js` — tiny Worker for the dynamic fallback surface (`/mcp` returns an honest 501 until the optional hosted MCP is implemented). Static asset requests stay on Cloudflare's asset path.
- `wrangler.jsonc` — Workers Static Assets config with an `ASSETS` binding. Cloudflare recommends JSONC for new Wrangler projects.
- `build.ts` — converts `website/source/` HTML into clean production routes, generates the agent surfaces required by the spec, and emits `_headers` / `_redirects` for the static hot path.

## Routes

- `/`, `/editor/`, `/examples/`, `/about/`, `/docs/`
- `/docs/api/`, `/docs/source-level/`, `/docs/cli/`, `/docs/mcp/`, `/docs/ascii/`, `/docs/theming/`, `/docs/config/`, `/docs/react/`, `/docs/quality/`, `/docs/fork-differences/`, `/docs/vocabulary/`
- `/skills/agentic-mermaid-diagram-workflow/`
- `/warnings/`, `/warnings/<CODE>/`, `/errors/`, `/errors/<kind>/`, `/examples/`, `/evidence/`, `/security/`, `/releases/`
- `/llms.txt`, `/agent-instructions.md`, `/capabilities.json`, `/examples/index.json`
- raw `/skills/agentic-mermaid-diagram-workflow/SKILL.md`

## Commands

```bash
bun run website          # rebuild website/public from website/source + product truth
bun run website:check    # verify generated website/public is current
bun run website:dev      # Wrangler dev server on port 9095
```

## Cloudflare agent setup

Cloudflare's official agent setup prompt is <https://developers.cloudflare.com/agent-setup/prompt.md>. This repo follows it for project-local MCP configuration:

- `.cursor/mcp.json` — Cursor MCP servers.
- `.vscode/mcp.json` — GitHub Copilot / VS Code MCP servers.

Both files register `cloudflare`, `cloudflare-docs`, `cloudflare-bindings`, `cloudflare-builds`, and `cloudflare-observability`. OAuth triggers on first authenticated Cloudflare tool use; `cloudflare-docs` is public.

Direct Wrangler (this project intentionally uses `wrangler@latest`; `wrangler.jsonc` starts from today's compatibility date):

```bash
cd website
WRANGLER_SEND_METRICS=false npx --yes wrangler@latest dev --port 9095 --ip 127.0.0.1
```

The static site does not expose hosted Code Mode, arbitrary code execution, or a REST render API. The optional hosted MCP route is not enabled in this preview; the worker returns a 501 with local-first guidance at `/mcp`.
