# Keeping docs consistent with the code

A fact that has one source in code — the families, the MCP tools, the CLI
verbs and flags, the warning codes and their descriptions, a family's no-op
config keys, the agent workflow — is either generated into a doc or pointed
at. It is not copied by hand. Hand copies are how the repo ended up
recommending two different ways to author a new diagram for months, and how
six docs kept listing a stale hosted tool set.

Four checks run in `bun run test`. Prose claims need an occasional audit by
hand.

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

`src/__tests__/doc-enumerations.test.ts` reads every maintained doc (the set
in `src/__tests__/helpers/maintained-docs.ts`) as paragraphs, lists, tables,
and code blocks, and holds each one to two rules.

**Complete lists declare themselves.** A hand-written unit that names every
member of a registry fails unless it carries a marker, inside the unit or
alone on the line directly above it:

```md
<!-- complete: hosted-mcp-tools -->
- `verify({ source })` returns structural `ok`, …
```

A marked unit must name every member, so a list that falls behind fails
however many members it is missing — the case where a pull request adds two
tools at once. The registry ids are the doc-block ids where one exists:
`family-ids`, `hosted-mcp-tools`, `local-mcp-tools`, `cli-verbs`,
`render-formats`, `warning-codes:structural`, `warning-codes:geometric`,
`warning-codes:lint`, plus `warning-codes` for every code. A unit names a
family by id, label, header, or narrower; a tool as `` `name` `` or
`` `name(…)` `` (bare inside a code block); a CLI verb as `` `<verb>` `` or
`am <verb>`; a render format as `` `svg` `` or `--format svg`; a warning code by
its name. A marker covers the registries inside it: a marked list of every
hosted tool is also a list of every local tool. A plain list does not need a
marker; generate it. A file whose header says "Do not edit by hand" is
generated as a whole and is not checked.

**Near-complete lists are stale.** An unmarked unit that names all but a few
members of a registry (n−k of n, with 1 ≤ k ≤ n/6) is almost always a copy
that fell behind. Small subsets pass.

Fix a finding by generating the list, marking it, adding the missing name, or
pointing at the registry. If the unit is a deliberate subset, a status note
that happens to name every member, or a list another test pins, add it to
`NOT_A_COPY` with the reason.

## Documented CLI commands

`src/__tests__/doc-cli-commands.test.ts` extracts every `am …`,
`agentic-mermaid-mcp …`, and package-runner invocation from shell fences and
inline code in the maintained docs, `llms.txt`, the `init-agent` bundle, and
the CLI's own help text. Each verb, flag, and `--format` value must be one
the CLI accepts (`COMMAND_FLAGS`, `CLI_RENDER_FORMATS`, `MCP_FLAG_SPECS`).

## Links, paths, and scripts

`src/__tests__/doc-references.test.ts` reads the maintained docs outside
generated blocks and fails when:

- a relative Markdown link does not resolve to a file or directory;
- a backticked repository path does not exist. A path is a token that starts
  with a tracked top-level directory (`src/…`, `scripts/…`, `.github/…`), a
  `./` or `../` file name, or an all-caps root document name such as
  `TODO.md`. It may be relative to the repository root or to the doc's own
  directory, and may carry a line suffix (`src/cli/index.ts:12-40`). Shell
  fences are read too; other fences hold example output and are not.
- `bun run <script>` or `npm run <script>` names no `package.json` script.

URLs, anchors, site routes (`/warnings/`), placeholders (`<file>`, `…`, `*`,
`{a,b}`), and paths into gitignored build output such as `website/public` are
skipped. A doc that names a path on purpose although it does not exist here —
a deleted file in a lesson, a path on an upstream branch — adds it to
`NAMED_BUT_ABSENT` with the reason.

Backticked code symbols are not checked. Measured over the maintained docs,
every `UPPER_SNAKE` constant or `camelCase()` call missing from the code was a
JavaScript builtin, a third-party or upstream Mermaid API, an illustration,
a name a plan proposes, or history; a rule would have needed a larger
allowlist than it had findings.

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

Skip anything the checks above already enforce: registry lists, CLI verbs,
flags, and formats, relative links, repository paths that do not exist, and
package scripts. Look for:

1. A claim that contradicts the code: a default value, a function, type, or
   constant name, a path that exists but is the wrong one, a count ("nine
   tools"), an exit code, a limit, or a behaviour. Confirm each one by reading
   the code it describes.
2. Two docs that contradict each other, including the agent guidance in
   `Instructions_for_agents.md`, `AGENT_NATIVE.md`, `llms.txt`, and the skills.
3. Stale status: "not yet published", "planned", "experimental", a version
   number, or a TODO item that the code or `CHANGELOG.md` shows is done.

Report only findings you verified against the code or another doc. For each
one, give the file and line, the claim, the evidence (a code path or the
contradicting doc), and the fix.

If there are no findings, stop without opening an issue. Otherwise, look for
an open issue whose title starts with "Doc consistency audit". If one exists,
add the findings to it as a comment and do not repeat findings it already
lists. If none exists, open an issue titled "Doc consistency audit
YYYY-MM-DD" with the findings as a task list. Do not open a pull request.
