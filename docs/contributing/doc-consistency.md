# Keeping docs consistent with the code

A fact that has one source in code — the families, the MCP tools, the CLI
verbs and flags, the warning codes and their descriptions, a family's no-op
config keys, the agent workflow — is either generated into a doc or pointed
at. It is not copied by hand. Hand copies are how the repo ended up
recommending two different ways to author a new diagram for months, and how
six docs kept listing a stale hosted tool set.

Two checks run in `bun run test`: generated blocks are current, and every
documented CLI invocation is one the CLI accepts. Everything else — registry
lists, links, paths, scripts, and prose claims — is audited by hand.

## Generated blocks

Wrap a fact in markers and `bun run doc-blocks` writes it from code:

```md
Hosted tools: <!-- BEGIN GENERATED: hosted-mcp-tools -->`execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`<!-- END GENERATED: hosted-mcp-tools -->.
```

A block can sit inside a sentence or table cell, or span lines. The block
ids and their renderers are in `scripts/docs/doc-blocks.ts`; `noop-keys`
takes a family id (`noop-keys:sequence`), and `warning-table` and
`warning-summaries` take a warning tier (`warning-table:lint`) and print the
descriptions in `src/agent/warning-catalog.ts`, which also feeds the
per-code pages on the website. `src/__tests__/doc-blocks.test.ts`
fails when a block is stale or names an unknown renderer. Code-generated
surfaces (`llms.txt`, the `init-agent` bundle, the Code Mode SDK declaration,
`am verify --help`) import the same constants instead.

Leave a list hand-written when each item carries its own annotation, and
mark it (see Registry lists); a deliberate subset needs neither.
`website/source/start.md` stays hand-written because the agent-usage evals
measure its exact wording.

Do not paraphrase what a warning code means. Point at its page under
`https://agentic-mermaid.dev/warnings/` or at the `AGENT_NATIVE.md` tier
tables, both generated from the catalog. Keep a sentence only when it says
something the catalog does not, such as which codes a family can raise.

## Registry lists

A hand-written unit that names every member of a registry declares itself
with a marker, inside the unit or alone on the line directly above it, so the
audit knows it must stay complete:

```md
<!-- complete: hosted-mcp-tools -->
- `verify({ source })` returns structural `ok`, …
```

The registry ids are the doc-block ids where one exists (`family-ids`,
`hosted-mcp-tools`, `local-mcp-tools`, `cli-verbs`, `render-formats`,
`warning-codes:<tier>`). An unmarked list that names all but a few members
of a registry is almost always a copy that fell behind: generate it, mark
it, or point at the registry instead.

## Documented CLI commands

`src/__tests__/doc-cli-commands.test.ts` extracts every `am …`,
`agentic-mermaid-mcp …`, and package-runner invocation from shell fences and
inline code in the maintained docs, `llms.txt`, the `init-agent` bundle, and
the CLI's own help text. Each verb, flag, and `--format` value must be one
the CLI accepts (`COMMAND_FLAGS`, `CLI_RENDER_FORMATS`, `MCP_FLAG_SPECS`).

## Audit by hand

Prose claims — "the hosted endpoint caches results", "Radar projects the
renderer AST", "0.4.2 is not yet published" — have no registry to check
against. Audit them from time to time, before a release for example, by
giving the prompt below to an agent with a checkout of `main`. The audit
reports findings in a GitHub issue and never blocks a merge.

### Audit prompt

Audit the maintained Markdown docs in this repository for internal
consistency. The maintained set is `git ls-files '*.md'` minus the
exclusions in `src/__tests__/helpers/maintained-docs.ts`. Text between
`<!-- BEGIN GENERATED` and `<!-- END GENERATED` markers is generated; skip it.

Skip generated blocks and the CLI verbs, flags, and formats the tests
enforce. Look for:

1. A claim that contradicts the code: a default value, a function, type, or
   constant name, a path that exists but is the wrong one, a count ("nine
   tools"), an exit code, a limit, or a behaviour. Confirm each one by reading
   the code it describes.
2. Two docs that contradict each other, including the agent guidance in
   `Instructions_for_agents.md`, `AGENT_NATIVE.md`, `llms.txt`, and the skills.
3. Stale status: "not yet published", "planned", "experimental", a version
   number, or a TODO item that the code or `CHANGELOG.md` shows is done.
4. A list marked `<!-- complete: … -->` that misses a registry member, or an
   unmarked list that names nearly all of one.
5. A relative link or backticked repository path that does not resolve, or a
   `bun run <script>` that names no `package.json` script.

Report only findings you verified against the code or another doc. For each
one, give the file and line, the claim, the evidence (a code path or the
contradicting doc), and the fix.

If there are no findings, stop without opening an issue. Otherwise, look for
an open issue whose title starts with "Doc consistency audit". If one exists,
add the findings to it as a comment and do not repeat findings it already
lists. If none exists, open an issue titled "Doc consistency audit
YYYY-MM-DD" with the findings as a task list. Do not open a pull request.
