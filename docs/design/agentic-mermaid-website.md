# Agentic Mermaid website specification

Status: draft. Owner decision needed for the production domain. This replaces the earlier idea of a hosted Cloudflare Code Mode app with a website that helps humans and agents use Agentic Mermaid locally and safely.

## Brief

Build a canonical Agentic Mermaid website on a dedicated domain, subsuming the current GitHub Pages gallery/editor while adding first-class agent onboarding. The site does **not** expose a hosted Code Mode endpoint, hosted MCP server, remote renderer API, or arbitrary code execution service.

Assumptions:

- The repo remains `adewale/beautiful-mermaid`; the product/site brand is **Agentic Mermaid**.
- A domain such as `agenticmermaid.dev` or `agenticmermaid.com` will become canonical.
- GitHub Pages may remain as a legacy mirror/redirect target during migration, but the new domain owns product discovery.
- The package truth remains `agentic-mermaid@0.1.0`, imports `agentic-mermaid` and `agentic-mermaid/agent`, bins `am`, `agentic-mermaid`, and `agentic-mermaid-mcp`.
- npm publishing is a launch dependency for public install instructions, but the website spec does not imply publishing approval.

## Product stance

The website is not “Mermaid live plus AI.” It is a **trustworthy operating manual and local workbench** for a diagram tool that agents can use.

Humans need confidence: “Will this render my diagram, can I export it, and how do I install it?” Agents need a sharper contract: “What can I call, what must I not call, what JSON shape tells me capabilities, and how do I verify before returning a result?”

The site should feel like a document/tool hybrid: calm docs, runnable examples, exact manifests, and one excellent local editor. Avoid generic SaaS hero patterns, hosted-agent claims, and any wording that implies the site will run untrusted agent code.

## AX framework

Mathias Biilmann frames Agent Experience around four questions: access, context, tools, and orchestration. For Agentic Mermaid, those map like this:

| AX area | Site decision |
|---|---|
| Access | Agents can access static docs, raw Markdown, JSON manifests, schemas, examples, and skill files without JavaScript, login, cookies, or browser automation. They do not access a hosted rendering or Code Mode backend. |
| Context | The site provides `llms.txt`, `agent-instructions.md`, `agent-manifest.json`, `capabilities.json`, recipes, warning/error pages, and raw skill files. Docs should support raw Markdown retrieval or content negotiation for agent fetches. |
| Tools | The tools remain local: package import, `am` CLI, and `agentic-mermaid-mcp`. The website teaches setup and returns machine-readable contracts; it does not become the tool runtime. |
| Orchestration | Out of scope for v1. The site does not trigger agent runs, queue work, host sandboxes, or run user code. Future orchestration must be a separate owner decision with a security model. |

This is the main product correction: AX does not mean adding a chatbot to the website. It means making any user’s chosen agent successful with local tools and exact context.

## Impeccable-informed journey principles

I used [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) as the comparison point because it solves a similar product problem: teach agents and humans one local tool without turning the website into the runtime. The patterns worth carrying over are product patterns, not visual branding.

1. **Start with setup, then recommend the next action.** Impeccable leads with install, project context, then one command. Agentic Mermaid should lead with install, `am init-agent`, then one verified diagram task.
2. **Use one front door with intent routing.** Impeccable hides 23 commands behind one `/impeccable` entrypoint. Agentic Mermaid should hide channel complexity behind one chooser: browser editor for humans, library for JS/TS agents, CLI for shell agents, local MCP for MCP clients.
3. **Make context files visible.** Impeccable explains `PRODUCT.md` and `DESIGN.md` as durable project context. Agentic Mermaid should show what `am init-agent` writes: `AGENTS.md`, `skills/`, `.mcp.json`, and the verify-before-commit rules.
4. **Demo the loop, not a claim.** Impeccable’s Live Mode page shows pick, generate, accept, write back. Agentic Mermaid should show parse, narrow, mutate/source-edit, verify, render, serialize as an animated or step-through demo using static/client-side examples only.
5. **Treat machine-readable files as product UI.** Impeccable ships `llms.txt`, docs, generated counts, and harness-specific install material. Agentic Mermaid should version and validate every agent artifact: manifests, schemas, capabilities, recipes, and examples.
6. **Index failure modes.** Impeccable’s detector lab and FAQ make errors browsable. Agentic Mermaid needs warning-code pages, parse-error examples, and “safe automatic fix?” guidance.
7. **Support harness differences directly.** Impeccable documents Claude, Cursor, Gemini, Codex, GitHub Copilot, Pi, OpenCode, and others. Agentic Mermaid should provide local setup cards for the same agent environments instead of assuming one MCP client.
8. **Avoid the fake-product surface.** Impeccable is clear about what runs locally and what the site demonstrates. Agentic Mermaid must be louder: no hosted Code Mode, no hosted MCP, no server-side render API.

## Additional design-engineering references

These references improve the site by tightening motion, polish, copy, and skill distribution. They should shape the website system, not become new product claims.

| Reference | Useful pattern | Agentic Mermaid application |
|---|---|---|
| [`emilkowal.ski/skill`](https://emilkowal.ski/skill) and [`emil-design-eng`](https://www.skills.sh/emilkowalski/skill/emil-design-eng) | A design-engineering skill that treats animation as a decision: frequency, purpose, easing, duration, performance. | Add an interaction rubric for editor/gallery controls. Frequent actions such as typing, keyboard shortcuts, and tab switching stay instant. Occasional actions such as export menus, examples drawers, warnings panels, and copy success get short, purposeful motion. |
| [`make-interfaces-feel-better`](https://www.skills.sh/jakubkrehel/make-interfaces-feel-better/make-interfaces-feel-better) | Small interface details as a reviewable checklist: concentric radii, optical alignment, tabular numbers, text wrapping, 40×40 hit areas, transition specificity. | Add a UI polish checklist to implementation acceptance. Apply it to editor controls, export menus, theme dropdowns, gallery filters, warning-code pages, and start-rail command cards. |
| [`animations.dev/vocabulary`](https://animations.dev/vocabulary) | Shared names for motion patterns so humans and agents can ask for the same thing. | Add a small `/vocabulary` or `/docs/vocabulary` page for Agentic Mermaid terms: parse, narrow, source-level-only, mutate, verify, warning tier, artifact, ASCII, Unicode, strict security. Include a motion subsection for site interactions. |
| [`anthropics/frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Hero as thesis, structure as information, one justified visual risk, copy as design material. | Make the homepage signature a working local workflow, not a generic AI-tool hero: source on one side, verify evidence and SVG/ASCII artifacts on the other. Use labels, numbers, and dividers only where they encode workflow state. |
| Skills marketplace pages | Clear install command, summary, related skills, audits, and support metadata. | Give the Agentic Mermaid skill bundle a product page with install/setup commands, supported harnesses, raw files, schemas, and security notes. |

## Aha moments

| Audience | First value moment | Site support |
|---|---|---|
| Human diagram author | Pastes Mermaid, sees a correct render, copies SVG/PNG/ASCII. | Editor opens fast, examples are one click, export controls explain output state. |
| Developer | Runs one command locally and gets a verified artifact. | Install rail: `npm install`, smoke test, `am verify`, `am render`. |
| Agent user | Adds Agentic Mermaid to a repo and sees an agent follow verify-before-commit. | `/agents` setup cards, `am init-agent`, MCP snippets, transcript-style examples. |
| Agent runtime | Fetches static docs and knows exactly what to call locally. | `/llms.txt`, `/agent-instructions.md`, `/agent-manifest.json`, `/capabilities.json`. |
| Maintainer | Confirms family/output coverage and limitations before adopting. | `/families`, `/gallery`, warning reference, changelog, quality docs. |

## Non-goals

- No hosted Code Mode `execute(code)` endpoint.
- No hosted MCP/SSE endpoint for arbitrary clients.
- No remote diagram-rendering API in v1.
- No accounts, cloud projects, saved diagrams, teams, billing, or private workspaces.
- No AI diagram generation chatbot.
- No package-publish automation from the site.
- No `beautiful-mermaid` compatibility wrapper or alternate package identity.

The site may run the renderer in the visitor’s browser for the editor/gallery. That is local client-side rendering, not a hosted execution surface.

## Public surface policy

The website publishes a curated product surface, not the repository tree.

Expose in primary navigation:

- landing/start rail;
- `/editor`, `/gallery`, and `/families`;
- install, API, CLI, local MCP, theming, config, React, ASCII/Unicode, quality, security, and fork-difference docs;
- `/agents`, `/agents/harnesses`, `/agents/workflow`;
- `/warnings`, `/errors`, recipes, schemas, and machine-readable manifests;
- the consumer `agentic-mermaid-diagram-workflow` skill landing page.

Keep repo-only or contributor-only by default:

- `TODO.md`, progress/scratch files, PR reviewer maps, and issue-derived test maps;
- `docs/project/*` and implementation design drafts unless explicitly promoted;
- eval transcripts, private-holdback references, Stryker/mutation configs, and benchmark internals;
- the `agentic-mermaid-live-editor` development skill;
- unsupported upstream Mermaid syntax references unless clearly labeled as authoring references, not renderer support.

Public pages must be generated from product truth where possible: package metadata, `am capabilities --json`, CLI help, warning tables, and the checked-in consumer skill. Do not hand-maintain a public table when a tested runtime source exists.

## Functionality exposure matrix

| Area | Expose on website? | Surface |
|---|---:|---|
| Browser-local SVG rendering | Yes | `/editor`, `/gallery`, examples. |
| Browser-local PNG export | Yes | `/editor` export, artifact docs. |
| Browser-local ASCII/Unicode output | Yes | `/editor`, `/gallery`, `/docs/ascii`, artifact docs. |
| Library API: `agentic-mermaid` | Yes | `/docs/api`, install recipes. |
| Agent API: `agentic-mermaid/agent` | Yes | `/agents`, `/docs/api`, recipes, `agent-manifest.json`. |
| CLI verbs: `render`, `verify`, `parse`, `serialize`, `mutate`, `preview`, `format`, `describe`, `capabilities`, `batch`, `render-markdown`, `llms-txt`, `init-agent` | Yes | `/docs/cli`, `/recipes/*`, warning/error pages. |
| Local MCP Code Mode | Yes, local setup only | `/docs/mcp`, `/agents`; stdio first, HTTP/SSE opt-in. |
| MCP HTTP/SSE transport | Yes, docs only | Local/loopback docs with non-loopback auth warning. |
| Managed MCP artifacts | Yes, docs only | Artifact recipe and MCP HTTP docs. |
| `agentic-mermaid-diagram-workflow` skill | Yes | Public skill landing, raw `SKILL.md`, required references. |
| `agentic-mermaid-live-editor` skill | No public product exposure | Keep out of product navigation, public skill catalog, and `am init-agent`. If retained, move to contributor docs or a development-only skill location excluded from package onboarding. |
| Upstream Mermaid syntax references in skills | Curated/guarded | Omit from product nav or stamp as non-rendering syntax references. |
| Eval manifests and quality evidence | Summarize | `/docs/quality` or `/evidence`; no private prompts/transcripts. |
| Mutation configs, Stryker details, backlog, project notes | No primary exposure | Repository only or contributor docs. |
| Hosted Code Mode/MCP/render API | No | Explicit non-goal and manifest negative capability. |
| `asciiToMermaid` reverse converter | Advanced docs only | API docs with lossy/best-effort warning. |
| TUI click-map metadata | Advanced docs only | API docs; not editor headline feature. |

## Primary audiences

| Audience | Real question | Website job |
|---|---|---|
| Agent runtime / LLM with browser or fetch access | “How do I use this package correctly?” | Serve stable machine-readable and plain-Markdown instructions with package names, command shapes, capabilities, warning codes, and stop rules. |
| Developer using an agent | “How do I install this into my repo/agent?” | Provide one-copy onboarding: npm install, CLI smoke test, `am init-agent`, local MCP config, CI recipe. |
| Human diagram author | “Can I paste Mermaid and get good SVG/PNG/ASCII?” | Provide a fast client-side editor with examples, theme/config controls, export, share links, and clear errors. |
| Maintainer / technical writer | “What diagram families and outputs are safe for docs?” | Provide searchable family coverage, examples, accessibility summaries, export guidance, and limitations. |
| Evaluator / contributor | “How is this different from Mermaid/Beautiful Mermaid?” | Provide honest fork differences, quality guarantees, test evidence, and contribution entrypoints. |

## Main human journeys

### H1 — Try a diagram and export it

1. Land on `/` and choose **Try editor** or paste directly into an embedded starter panel.
2. Open `/editor` with a blank source editor by default and obvious examples.
3. Paste Mermaid source.
4. See render status, parse/render errors, and timing.
5. Adjust theme/config if needed.
6. Export SVG/PNG, copy source, copy SVG/image, copy ASCII/Unicode text, or copy a share URL.

Success criteria:

- The user can complete the journey without an account, network API, or build tool.
- Invalid diagrams fail visibly and preserve source.
- Export buttons are disabled until a valid render exists.
- ASCII/Unicode output is available as a first-class text artifact, not hidden inside docs.
- Source never leaves the browser for rendering.
- Copy/share URL actions warn that source, theme, and config may be encoded in the URL and should not be shared for private diagrams.

### H2 — Decide whether Agentic Mermaid supports a project

1. Visit `/families` or `/capabilities`.
2. Filter by diagram family, output format, and edit policy.
3. Inspect representative examples with source, SVG, ASCII/Unicode where available, and known limitations.
4. Copy a minimal fixture into their repo.

Success criteria:

- Family support is not overclaimed: source-level-only families are clearly marked.
- Unsupported or planned families are listed separately from supported ones.
- The page exposes the same data as `/capabilities.json`.

### H3 — Install for local docs/CI

1. Visit `/install` or the homepage install strip.
2. Copy `npm install agentic-mermaid` and a smoke test, or see a clear pre-release/source-install note if npm is unavailable.
3. Copy CLI commands for `am render`, `am verify`, `am describe`, `am preview`, `am batch --jsonl`, `am render-markdown`, JSON layout, and SVG/PNG/ASCII/Unicode output.
4. Optionally copy a GitHub Actions/CI snippet.

Success criteria:

- Install docs are versioned and match `package.json`.
- If the package is not published yet, the public site says so instead of showing a fake npm path.
- The first command verifies the package works locally.

### H4 — Configure an agent

1. Visit `/agents`.
2. Choose the environment: CLI-only, JS/TS library, local MCP Code Mode.
3. Copy one setup block:
   - install package;
   - run `am init-agent`;
   - use local `.mcp.json` if desired;
   - read `Instructions_for_agents.md`.
4. Copy a task recipe: create, edit existing structured diagram, render artifacts, verify CI.

Success criteria:

- The page teaches local execution, not a hosted endpoint.
- It gives agents enough context to avoid regeneration, unverified serialization, and unsupported mutation.
- Every snippet is tested or generated from tested docs.

### H5 — Browse examples and learn style/output tradeoffs

1. Visit `/gallery`.
2. Filter by family/theme/output.
3. Compare source/SVG/ASCII/Unicode/PNG-export behavior.
4. Open any sample in the editor.

Success criteria:

- This subsumes the current GitHub Pages gallery.
- Each example has stable deep links and copy buttons.
- Dense examples are available, but the page starts with a small curated set.

### H6 — Fix a warning or failed render

1. Hit an error in the editor, CLI, or agent run.
2. Follow the linked warning/error code to `/warnings/<code>` or `/errors/<code>`.
3. See a minimal bad source example, the corrected source, CLI/library checks, and whether an agent can safely fix it.
4. Return to the editor or local command with the corrected source.

Success criteria:

- Every warning tier has a concrete page with examples.
- The page says whether the issue is structural, geometric, lint-only, or output-specific.
- The fix guidance does not ask users to understand internals first.

### H7 — Choose the right local agent setup

1. Visit `/agents` from the homepage or docs.
2. Pick a harness card: Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, Pi, OpenCode, or generic MCP.
3. Copy the smallest setup for that harness.
4. Run `am init-agent` or paste the local MCP config.
5. Verify with a one-diagram task.

Success criteria:

- Harness cards name the exact file paths or config shape where known.
- The generic path stays available for unknown harnesses.
- The setup ends with a local smoke test, not with “now ask your agent.”

### H8 — Understand the agent loop before trusting it

1. Visit `/agents/workflow` or the homepage demo.
2. Step through a small diagram edit: parse, narrow, mutate, verify, serialize, render.
3. Toggle a source-level-only family to see why mutation stops.
4. Copy the equivalent library, CLI, or MCP recipe.

Success criteria:

- The demo is client-side/static and never executes user-supplied agent code on the server.
- It teaches preservation and verification, not “AI magic.”
- It includes the failure branch where verify returns warnings.

## Main agent journeys

Agents do not need a prettier homepage. They need stable retrieval, exact commands, and machine-readable boundaries.

### A1 — Discover the tool contract

1. Fetch `/llms.txt`.
2. Fetch `/agent-instructions.md` for the canonical short guide.
3. Fetch `/agent-manifest.json` for URLs, package name, current version, and recommended entrypoints.
4. Fetch `/capabilities.json` for families, outputs, warning codes, edit policies, and mutation ops.

Success criteria:

- All files are static, cacheable, CORS-readable, and useful without JavaScript.
- The manifest says “no hosted Code Mode endpoint” explicitly.
- JSON schemas are linked from the manifest.

### A2 — Pick the right local channel

1. Read channel matrix from `/agents` or `/agent-manifest.json`:
   - JS/TS available → import `agentic-mermaid/agent`.
   - shell only → use `am` CLI.
   - MCP client configured → launch local `agentic-mermaid-mcp`.
2. Copy the narrowest recipe.
3. Run local smoke test.

Success criteria:

- The site does not tell an agent to call the website as a renderer/API.
- The setup path is explicit about stdio default for MCP and HTTP/SSE opt-in.
- The agent can detect if npm is unavailable and report that as a blocker.

### A3 — Edit an existing diagram safely

1. Parse source.
2. Inspect family and edit policy.
3. Narrow only when a typed narrower exists.
4. Mutate using advertised ops, or stop/source-edit deliberately for source-level-only families.
5. Verify before serialize/render.
6. Return source plus warnings/artifacts.

Success criteria:

- `/capabilities.json` and docs agree on all mutation ops.
- Stop rules are visible: do not mutate unsupported families, do not fabricate `ValidDiagram`, do not serialize before inspecting verify.
- Warning tiers are documented with severities and example fixes.

### A4 — Generate reviewable artifacts

1. Use local library/CLI to render SVG, PNG, ASCII/Unicode, or JSON layout.
2. Use `/recipes/artifacts.md` for exact commands.
3. Include human-reviewable outputs in the calling repo/PR.

Success criteria:

- The website explains output tradeoffs without acting as a binary artifact host.
- PNG instructions are clear about local file output and deterministic fonts.

### A5 — Recover from errors

1. Receive parse/mutate/verify/render error.
2. Look up code in `/warnings` or `/errors`.
3. Apply a documented fix recipe.
4. Re-run verify.

Success criteria:

- Error pages are indexed by exact warning/error code.
- Each warning page includes “safe automatic fix?” and “when to ask a human?” guidance.

### A6 — Install into a specific harness

1. Read `/agent-manifest.json` or `/agents/harnesses`.
2. Select the detected harness if the host reveals one, otherwise use generic local setup.
3. Follow the path for that harness:
   - CLI-only: shell commands and `am` recipes;
   - JS/TS-capable: import recipes;
   - MCP-capable: local `agentic-mermaid-mcp` config;
   - skills-capable: hosted skill bundle or `am init-agent` output.
4. Run the harness-specific smoke task.

Success criteria:

- The agent can proceed without guessing config paths.
- Unsupported harness features are explicit.
- No route points at the website as an execution backend.

### A7 — Decide when to stop and ask for human review

1. Inspect `verify` warnings, edit policy, output format, and requested change.
2. If the family is source-level-only and the task asks for semantic restructuring, report the limitation.
3. If the output is visual-quality-sensitive, include SVG/PNG/ASCII artifacts for human review.
4. If warnings remain, return source plus warnings instead of claiming success.

Success criteria:

- Stop rules are machine-readable in `/agent-manifest.json` and human-readable in `/agents`.
- The site gives examples of acceptable refusal/limitation responses.
- Agents do not confuse `verify.ok` with visual perfection.

## Journey support model

| Journey type | Primary route | Best support pattern |
|---|---|---|
| First visit | `/` | Three-way start rail: try, install, configure agent. No feature-grid maze. |
| First render | `/editor` | Blank editor, one-click examples, visible SVG and ASCII/Unicode outputs, disabled exports until valid. |
| First local install | `/install` | Copyable three-step rail with smoke test and npm availability truth. |
| First agent setup | `/agents` | Channel chooser, harness cards, `am init-agent` output preview, one smoke task. |
| First safe edit | `/agents/workflow` | Static/client-side loop demo with the failure branch included. |
| Family decision | `/families` | Filterable matrix generated from capabilities, with examples and limitations. |
| Warning recovery | `/warnings/<code>` | Bad source, fixed source, exact commands, safe-fix threshold. |
| Artifact production | `/recipes/artifacts.md` | SVG/PNG/ASCII/Unicode/JSON commands, plus when each output is the right review artifact. |
| No-JS agent retrieval | static Markdown/JSON | Raw files with schemas, CORS, version, git SHA, and stable fragments. |
| Legacy visitor | `/beautiful-mermaid/*` mirror or redirect | Keep old links working during the domain cutover. |

## Agent experience (AX) requirements

AX here means **agent experience**: how easy it is for a non-human caller to retrieve truth, choose an action, and avoid unsafe guesses.

### Static agent surfaces

| Route | Format | Purpose |
|---|---|---|
| `/llms.txt` | text | Compact discovery digest. Generated by `am llms-txt`. |
| `/agent-instructions.md` | Markdown | Canonical short guide. Generated by `am --agent-instructions`. |
| `/agent-manifest.json` | JSON | Site/package manifest: package identity, machine routes, public skills, stop rules, and negative hosted-execution capabilities. |
| `/capabilities.json` | JSON | Output of `am capabilities --json`, including families, edit policies, outputs, warning codes, mutation ops. |
| `/schemas/capabilities.schema.json` | JSON Schema | Schema for `/capabilities.json`. |
| `/schemas/agent-manifest.schema.json` | JSON Schema | Schema for `/agent-manifest.json`. |
| `/schemas/harnesses.schema.json` | JSON Schema | Schema for `/harnesses.json`. |
| `/schemas/skills.schema.json` | JSON Schema | Schema for `/skills/index.json` and per-skill manifests. |
| `/examples/index.json` | JSON | Curated examples with family, source, supported outputs, docs links, and editor deep links. |
| `/harnesses.json` | JSON | Known local setup paths and capabilities for Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, Pi, OpenCode, and generic MCP. |
| `/recipes/index.json` | JSON | Recipe catalog with generated hashes, source docs, and required local tools. |
| `/recipes/*.md` | Markdown | Tested copy-paste recipes for library, CLI, local MCP, CI, artifacts, and source-level fallback. |
| `/skills/index.json` | JSON | Public consumer skill catalog with raw file URLs, references, hashes, and install guidance. Contributor/development skills are omitted. |
| `/skills/agentic-mermaid-diagram-workflow` | HTML + raw Markdown links | Consumer skill landing: setup command, supported local channels, renderable-family matrix, raw files, schemas, and safety notes. |
| `/skills/agentic-mermaid-diagram-workflow/SKILL.md` | Markdown | Raw consumer skill entrypoint for agents. |
| `/openapi.json` | JSON | Only if a future non-execution read-only API exists. Not needed for v1. |

### Required manifest fields

`/agent-manifest.json` must include:

- `package`: name, version, imports, bins, npm status, checked timestamp;
- `repo`, canonical site, and legacy Pages base;
- `hostedExecution`: `{ codeMode:false, mcp:false, renderApi:false }`;
- `machineRoutes`: llms, instructions, capabilities, schemas, examples, harnesses, recipes, skills;
- `skills`: public skill ids and raw entrypoint URLs;
- `stopRules`: verify before serialize/render/return, source-level-only behavior, no fabricated `ValidDiagram`, no website execution backend;
- `generatedFrom`: package version, git SHA, build time.

`/skills/index.json` and each per-skill manifest must include:

- skill name, description, `scope: "consumer"`, entrypoint URL, raw files, required references, optional references, and SHA-256 hashes;
- supported local channels: library, CLI, local MCP, skills-capable harnesses;
- supported families, output formats, and edit policies when relevant;
- a `capabilitiesAuthority` URL pointing to `/capabilities.json`;
- a warning that upstream Mermaid syntax references are not render-support claims.

### Required recipe inventory

Recipes must include:

- `new-diagram.md` for source authoring, parse, verify, render;
- `existing-structured-edit.md` for parse, narrow, mutate, verify, serialize;
- `source-level-only.md` for journey, xychart, architecture, and opaque fallback bodies;
- `artifacts.md` for SVG, PNG, ASCII, Unicode, and JSON layout;
- `batch-repo.md` for `am batch --jsonl` and multi-file checks;
- `markdown.md` for `am render-markdown`;
- `quality-review.md` for `verify.layout`, `measureQuality`, screenshots, PNG/SVG/ASCII review, and human escalation;
- `local-mcp.md` for stdio-first local MCP and HTTP/SSE opt-in.

### Retrieval rules

- Every machine route returns the right `content-type` and is readable without client-side hydration.
- Every JSON route has a schema and a `generatedFrom` field with package version and git SHA.
- All agent files use canonical package names and avoid aliases.
- All docs pages expose a raw Markdown equivalent or obvious “Copy Markdown” action.
- The site supports stable fragment IDs for every section and warning code.
- Robots and sitemap should allow agents to find docs, but not force them through the editor bundle.

### Skill exposure rules

- The default public skill is `agentic-mermaid-diagram-workflow`; it is for consumers authoring, editing, verifying, serializing, and rendering diagrams.
- `agentic-mermaid-live-editor` is a contributor/development skill. Do not include it in `am init-agent`, product onboarding, or primary skill navigation.
- If contributor skills are published, put them under contributor docs with a scope label and no install CTA for normal users.
- Do not index upstream Mermaid syntax references as supported Agentic Mermaid families. `/capabilities.json` is authoritative for renderer support.
- A skill page must show raw file links, copyable setup, supported local channels, and current version/hash metadata.

### Agent-facing copy rules

- Say what is shipped, what is local, and what is not available.
- Put stop rules before clever examples.
- Prefer exact commands over prose.
- Include failure returns as well as happy paths.
- Keep snippets small enough to paste into an agent call.
- Version all generated facts and never hardcode capability tables by hand.

## Interaction and motion requirements

Motion should help users understand state, never slow down repeated work.

- Typing in the editor, keyboard shortcuts, pane tabs, and zoom controls should respond immediately. No decorative delay on high-frequency actions.
- Export dropdowns, examples drawers, warning panels, copy confirmations, and first-run start-rail reveals may animate because users see them less often.
- Use CSS transitions for interactive state so motion can be interrupted. Reserve keyframes for one-shot entrances or loading specimens.
- Prefer transform and opacity. Do not use `transition: all`; specify exact properties.
- Use short durations: 100-160ms for press feedback, 125-200ms for tooltips/small popovers, 150-250ms for dropdowns, 200-300ms for drawers and larger panels.
- Make popovers and menus origin-aware where possible. Menus should open from their trigger; modals stay centered.
- Pressable controls should have tactile feedback, usually a subtle scale near `0.96`, unless reduced-motion or dense repeated use argues for none.
- All interactive targets should have at least a 40×40px hit area, including icon-only toolbar buttons.
- Use tabular numbers for render time, warning counts, version-like metrics in dashboards, and any changing counters.
- Use `text-wrap: balance` for short headings and `text-wrap: pretty` for short prose. Do not apply either to code or preformatted Mermaid/ASCII output.
- Nested rounded surfaces should use concentric radii or avoid nesting. Do not stack generic cards around the editor.
- Honor `prefers-reduced-motion` everywhere. Reduced motion should keep state understandable with instant changes or short fades.

## Accessibility requirements

The site also needs strong human accessibility alongside agent AX.

- Keyboard-first navigation for the editor, gallery filters, theme picker, export menu, and docs search.
- Visible focus states and skip links.
- Screen-reader labels for editor panels, render status, export buttons, and examples.
- `aria-live` render/error status that is useful but not noisy.
- Preview diagrams wrapped in `<figure>` with a generated text summary from `describeMermaid` when possible.
- “Text description” panel for each gallery/editor render: family, nodes/tasks/entities, edges/dependencies, entry points, sinks, warnings.
- No color-only status; warning tiers use labels and icons/text.
- High-contrast and reduced-motion support.
- Mobile layout keeps code, config, and preview reachable without horizontal traps.
- Export/copy actions announce success/failure.

## What human users actually need

Must ship:

- A clear landing page: what Agentic Mermaid is, why it exists, install, try editor, agent setup.
- A “start rail” with three actions: try editor, install locally, configure an agent.
- A client-side live editor: source, render, config/theme, examples, SVG/PNG/ASCII/Unicode/copy/share, zoom/pan.
- A gallery/showcase: curated examples across supported families and outputs.
- A family/capability matrix: human-readable version of `/capabilities.json`.
- Install/API docs: library, CLI, local MCP, CI, batch, describe, preview, render-markdown, PNG, ASCII/Unicode, JSON layout.
- Focused docs for theming, config/frontmatter, React, ASCII/Unicode, quality, fork differences, security, warnings, and errors.
- Agent setup page: `am init-agent`, local MCP, skill bundle, verify-before-commit rule.
- Harness setup cards for the common agent environments.
- Step-through agent workflow demo using static/client-side examples.
- Warning/error reference with examples and safe-fix guidance.
- Shared vocabulary page for agent and human terminology.
- Skill-bundle landing page modeled after a skill marketplace listing, with install command, supported harnesses, raw files, and safety notes.
- Security/privacy page: no hosted code execution, no server-side diagram storage, local browser rendering, strict-mode guidance.
- Release/version page: current package version, git SHA, changelog link, npm status.

Should ship after the migration works:

- Docs search with keyboard shortcuts.
- Warning/error code reference with fix recipes.
- Motion and interaction design-system page with allowed patterns, durations, and reduced-motion behavior.
- “Open this sample in editor” everywhere.
- Side-by-side output comparison for SVG vs ASCII vs Unicode.
- Copyable CI templates.
- Small “agent card” at the top of relevant docs pages with machine URLs and setup commands.

Should not ship unless a future product decision changes the scope:

- Login or persistence.
- Cloud rendering API.
- Hosted Code Mode or hosted MCP.
- AI prompt-to-diagram generation.
- Team/workspace features.
- Payment/pricing pages.

## Information architecture

Recommended routes:

| Route | Audience | Content |
|---|---|---|
| `/` | humans + agents | Product overview, try/install/agent setup, current version, no-hosted-endpoint notice. |
| `/editor` | humans | Current GitHub Pages live editor, redesigned as canonical app with SVG preview plus ASCII/Unicode text output. |
| `/gallery` | humans | Current sample showcase with filters, deep links, and SVG/ASCII/Unicode output tabs where supported. |
| `/families` | humans + agents | Supported family matrix, outputs, edit policy, examples. |
| `/agents` | humans configuring agents + agents | Channel chooser, setup commands, local MCP notes, stop rules. |
| `/agents/harnesses` | humans configuring agents + agents | Harness-specific local setup cards and smoke tasks. |
| `/agents/workflow` | humans configuring agents + agents | Step-through parse/narrow/mutate/verify/serialize/render demo. |
| `/docs` | humans + agents | Documentation index. |
| `/docs/api` | developers + agents | Library/API docs. |
| `/docs/cli` | developers + agents | CLI recipes. |
| `/docs/mcp` | developers + agents | Local MCP setup, stdio default, HTTP/SSE opt-in security. |
| `/docs/ascii` | humans + agents | ASCII/Unicode output, color modes, terminal use, limitations. |
| `/docs/theming` | humans + developers | Built-in themes, CSS variables, Shiki import, role styling. |
| `/docs/config` | developers + agents | Mermaid frontmatter, init directives, supported runtime config. |
| `/docs/react` | developers | Zero-flash React integration. |
| `/docs/quality` | humans + agents | Determinism, `verify.ok` limits, quality metrics, visual-review artifacts. |
| `/docs/fork-differences` | humans + evaluators | How Agentic Mermaid differs from Mermaid and upstream Beautiful Mermaid. |
| `/docs/vocabulary` | humans + agents | Shared Agentic Mermaid terms and site motion vocabulary. |
| `/warnings` | agents + humans | Warning tiers, severities, fixes. |
| `/warnings/<code>` | agents + humans | Minimal bad source, corrected source, safe-fix guidance, and review threshold. |
| `/errors` | agents + humans | Parse, mutation, render, and CLI error classes with recovery recipes. |
| `/errors/<code>` | agents + humans | Bad input, corrected input, local verification command, and escalation threshold. |
| `/examples` | agents | Example index as docs; JSON version at `/examples/index.json`. |
| `/evidence` | evaluators | Curated quality/eval evidence, CI status, and hidden-prompt policy without raw private transcripts. |
| `/security` | humans + agents | Security model, no hosted execution, CSP, SVG external refs, share-link privacy. |
| `/releases` | humans + agents | Version, changelog, npm availability, git SHA. |
| `/llms.txt` | agents | Discovery digest. |
| `/agent-instructions.md` | agents | Canonical guide. |
| `/agent-manifest.json` | agents | Machine manifest. |
| `/capabilities.json` | agents | Machine capabilities. |
| `/schemas/*` | agents | JSON schemas. |
| `/skills` | humans + agents | Public consumer skill catalog. |
| `/skills/agentic-mermaid-diagram-workflow` | humans + agents | Consumer skill landing page with setup, supported harnesses, raw files, and safety notes. |
| `/skills/agentic-mermaid-diagram-workflow/SKILL.md` | agents | Raw consumer skill entrypoint. |

## Current GitHub Pages functionality to subsume

The new site must preserve or improve:

- Gallery homepage generated from `scripts/site/generate.ts`.
- Client-side rendering bundle from `src/browser.ts`.
- Category filters and theme pills.
- Live editor generated from `scripts/site/editor.ts`.
- Blank editor default with example discovery.
- Theme switcher, dark/light mode, config panel, color/font controls, padding/stroke controls.
- URL hash sharing with source/theme/config.
- SVG and PNG export, copy source, copy SVG/image/link.
- ASCII/Unicode output panel with copy/download `.txt` actions.
- Zoom, fit, pan, mobile code/config/preview tabs.
- Hosted `llms.txt` and `agent-instructions.md`.
- Static assets from `public/`.

Known upgrades during migration:

- Add `/capabilities.json` and `/agent-manifest.json` to generated site artifacts.
- Add ASCII/Unicode preview and export to the editor and gallery, using the browser-exposed `renderMermaidASCII` path.
- Add accessible diagram descriptions to gallery/editor preview.
- Add curated user/agent docs pages as first-class site routes rather than exposing the repository docs tree wholesale.
- Replace `/beautiful-mermaid/` path assumptions in generated HTML with domain-relative or configurable base URL.

## Domain and deployment

Recommended deployment shape:

- Cloudflare Pages for static assets and preview deployments.
- Optional Cloudflare Worker only for redirects, headers, cache policy, and immutable asset routing.
- No Worker route that evaluates user code or renders diagrams server-side.
- Canonical domain configured by environment variable, e.g. `SITE_ORIGIN=https://agenticmermaid.dev`.
- Base path configurable so the same generator can still build the GitHub Pages mirror under `/beautiful-mermaid/` during transition.

Headers:

- Strong CSP for app pages; allow only needed fonts/assets.
- Long-cache hashed bundles; short-cache machine manifests.
- `Access-Control-Allow-Origin: *` for static JSON/Markdown agent artifacts.
- `X-Content-Type-Options: nosniff`.
- No cookies required for core use.

## Migration plan

1. **Spec and route inventory.** Land this spec, update backlog from “Cloudflare Code Mode web app” to “Agentic Mermaid website.”
2. **Static artifact generation.** Extend site build to emit `/llms.txt`, `/agent-instructions.md`, `/capabilities.json`, `/agent-manifest.json`, `/harnesses.json`, `/skills/index.json`, per-skill manifests, schemas, `/recipes/index.json`, and `/examples/index.json`.
3. **Base URL abstraction.** Remove hardcoded `/beautiful-mermaid/` links from generated site HTML; support canonical domain and GitHub Pages base path.
4. **Site shell.** Create homepage, docs index, agents page, families page, security page, releases page.
5. **Impeccable-style journey layer.** Add the start rail, intent/channel chooser, harness cards, workflow demo, warning-code pages, and FAQ before expanding visual polish.
6. **Editor/gallery migration.** Move existing Pages editor/gallery into the new route structure without losing current E2E coverage.
7. **AX pass.** Add raw Markdown links for curated public docs only, copyable agent cards, accessible diagram descriptions, warning/error-code references, public-skill bundle generation, schema validation tests, and a guard that product navigation does not expose hidden repo-only docs or development skills.
8. **Cloudflare deployment.** Add Cloudflare Pages config and preview deploy docs. Keep GitHub Pages until the new domain is verified.
9. **Cutover.** Update README/docs links to canonical domain. Keep old `/beautiful-mermaid/` links working where feasible.

## Acceptance criteria

- The site has no hosted Code Mode, MCP, or render API endpoint.
- `/editor` and `/gallery` cover all current GitHub Pages functionality and add first-class ASCII/Unicode text output.
- `/llms.txt`, `/agent-instructions.md`, `/capabilities.json`, `/agent-manifest.json`, `/harnesses.json`, `/skills/index.json`, `/recipes/index.json`, and schemas are generated, validated, and linked.
- A JS-disabled crawler can retrieve agent docs, package names, capabilities, setup commands, skill files, and harness setup guidance.
- A keyboard-only user can edit, render, inspect errors, export, and navigate docs.
- Generated site docs match package metadata, CLI help, warning codes, and capability registry.
- The homepage contains the three-way start rail, and each path reaches value in one screen plus one copied command or action.
- Editor/gallery interactions pass the motion and polish checklist: no `transition: all`, 40×40 hit areas, reduced-motion behavior, tabular changing numbers, and purposeful animation only.
- Public install instructions are gated on actual npm availability or clearly marked pre-release.
- Product navigation exposes only curated user/agent docs. It does not link `TODO.md`, `docs/project/*`, implementation design drafts, eval transcripts, mutation configs, or the live-editor development skill.
- The public skill landing exposes the diagram workflow skill and states that `/capabilities.json` overrides any syntax reference.
- Unsupported Mermaid-family reference pages are omitted from product navigation or clearly marked as non-rendering authoring references.
- Share-link copy warns when source is embedded in the URL.

## Open decisions

- Production domain name.
- Whether GitHub Pages remains a mirror indefinitely or becomes a redirect-only legacy path.
- Whether docs are generated from Markdown at build time or served as styled raw Markdown with a lightweight shell.
- Whether site search is local static search or deferred.
- Which harness cards ship in v1, and which stay generic.
- Whether `agentic-mermaid-live-editor` should remain a skill at all, move to contributor docs, or move to a development-only skill directory excluded from public package/site artifacts.
- Whether the website offers a downloadable agent bundle/ZIP in addition to `am init-agent`.
- Whether examples include pre-rendered SVG/ASCII artifacts for no-JavaScript preview.
