# Edit arms: typed editing vs text editing on held-out diagrams

This evaluation tests the product claim behind typed editing:

> For edits to existing Mermaid diagrams, the typed path (parse → mutate →
> verify → serialize) produces correct edits with less collateral damage than
> letting the model edit the Mermaid text directly and then rendering/verifying
> with Agentic Mermaid.

The earlier evidence (`eval/agent-usage`, TODO EVAL-3) used three runs of one
model on two cases built to need the tool, and its trace linter classifies
whole-source regeneration as an anti-pattern (`REGENERATE`). Here regeneration
is part of the baseline arm and is measured rather than forbidden. The analysis
plan, decision rule and sample size are fixed in
[PREREGISTRATION.md](PREREGISTRATION.md).

## Layout

| Path | Role |
|---|---|
| `corpus/` | **Held-out** set: 41 real-world diagrams, 63 edit tasks with hand-written reference edits. Not for development or tuning — see [corpus/README.md](corpus/README.md). |
| `oracle.ts` | Semantic models from upstream Mermaid 12.2.0's own parser and diagram DB. |
| `score.ts` | Per-output scoring: intended change, collateral change, source preservation, parse. |
| `arms.ts` | Request text per arm (identical except the Tools section). |
| `run.ts` | CLI: `list`, `validate`, `prepare`, `record`, `finalize`, `report`, `cost`. |
| `stats.ts` | Case-clustered paired bootstrap (seeded). |
| `edit-arms.test.ts` | Deterministic self-tests of the scorer (no model calls). |


## Arms

Every request carries the same framing, user request, diagram (inline and as
`scratch/<id>/diagram.mmd`) and response contract. Only the Tools section
differs:

- **A — text edit + verify.** The agent edits the Mermaid text itself; patching
  lines or rewriting the whole source are both allowed. It may run
  `am verify` and `am render` and retry. Typed editing surfaces are off-limits.
- **B — typed path.** The agent edits through parse → narrow → mutate → verify
  → serialize (CLI `am mutate [--preserve-source]` or the library), with a
  declared "source-level fallback" for anything no operation expresses.
- **C — no tools** (optional). The agent answers from the request alone.

## Oracle

`startOracle()` reuses the repository's independent Mermaid reference
(`eval/mermaid-modern-compat/reference.ts`): a separate Node + jsdom process
imports the `mermaid` package from `MERMAID_REFERENCE_DIR` (default
`../mermaid-reference`, installed by `bun run reference:mermaid`), runs
`mermaid.parse` and `mermaidAPI.getDiagramFromText`, and snapshots every
argument-free `get*` getter of the parsed diagram's DB
(`reference-snapshot.mjs`). The oracle refuses any Mermaid version other than
the policy pin in `docs/project/upstream-mermaid-policy.json` (12.2.0). No
Agentic Mermaid code is involved in scoring.

Each family's DB snapshot is projected to facts — small tuples such as
`["edge","SP","AS",""]` or `["participantLabel","L","label-manager"]`.
Elements that did not exist before the edit are renamed to `+<display text>`,
so two correct edits that chose different ids for a new node compare equal.
Presentation attributes of new elements (shape, class, group, arrow style) are
free unless a task lists them in `strictNew`.

| Family | Check | What the facts cover | Not seen |
|---|---|---|---|
| flowchart | full | direction, nodes, labels, shapes, subgraph membership, classes, node styles, links, edges with labels, arrow kind and `linkStyle` per edge, classDefs, title/acc text | `linkStyle default`, init directives/theme, edge length |
| sequence | full | participants (kind, label, order), boxes, create/destroy, messages, notes, activations and block markers in order (`next` facts) | wrap flags, links, actor properties, directives |
| class | full | classes, labels, generics, annotations, members, methods, namespaces, css classes/styles, relations (labels, cardinalities, kind), notes | member order, click/link statements, classDef styles |
| state | full | states and composites, descriptions, shapes (choice/fork/join), parents, transitions with labels, notes by target, classes/styles, classDefs | note placement; `[*]` pseudo-states are named by enclosing composite |
| er | full | entities, aliases, attributes (type, name, keys, comment), relationships (cardinalities, identifying, role), classes/styles | attribute order |
| gantt | full | settings, sections and order, tasks by text with section, computed start/end, flags, authored ids, task order | authored date expressions (computed times are compared), tickInterval |
| gitGraph | full | branches and order, commits (branch, type, message, tags), parents | commits without an authored id are named branch#ordinal |
| pie | **weaker** | title, showData, slices with values | slice order (the snapshot sorts slices by label) |
| any other | **weaker** | generic diff of every DB leaf by JSON path | element identity; intended vs collateral cannot be separated by element |

Directives, frontmatter, comments and style lines are also measured textually
by the preservation sub-metrics, which is the only check for the items marked
"not seen" above.

## Scores

For each output, against the task's reference edit (the best-matching one
when several are accepted):

- **(a) intended** — every required fact of the reference delta appears in the
  output's delta.
- **(b) collateral** — the output's delta contains a fact the reference delta
  does not (anything else changed).
- **(c) preservation** — share of the non-blank source lines the reference
  leaves untouched that survive byte-for-byte, in order, in the output; also
  reported separately for comment, style (`classDef`/`class`/`style`/
  `linkStyle`/`:::`) and directive/frontmatter lines.
- **(d) parses** — Mermaid 12.2.0 accepts the output.
- **success** = a ∧ ¬b ∧ d. **damage** = b, or the output is missing or
  unparseable (primary harm measure).

Per arm, `finalize` reports success, damage, collateral among parseable
outputs, intended and parse rates, mean preservation, observed tokens/turns/
wall time, and arm compliance from `AM_TRACE_LOG` traces. Paired comparisons
(B − A, C − A, B − C) are case-clustered bootstrap 95% intervals.

## Commands

The Mermaid 12.2.0 reference must be installed (`bun run reference:mermaid`);
set `MERMAID_REFERENCE_DIR` if it is not at `../mermaid-reference`.

```sh
bun run eval:edit-arms -- list        # corpus summary
bun run eval:edit-arms -- validate    # every reference applies, parses and changes the model
bun run test:edit-arms                # scorer self-tests
```

**1. Prepare request files.** Pilot (10 family-stratified tasks × arms A, B ×
1 run):

```sh
bun run eval:edit-arms -- prepare --arms A,B --runs 1 --sample 10 --seed 1 \
  --provider claude-subagent --model <model-id>
```

Full run per model: `--arms A,B --runs 5` (add `C` for the no-tools arm; omit
`--sample` for all 63 tasks, or pass `--cases id,id`). The command prints the
run directory, `reports/edit-arms/<provider>-<model>-<timestamp>/` (gitignored), holding
`requests/<id>.md`, `scratch/<id>/diagram.mmd`, `edit-arms-run.json` (request
digests, corpus digest and a seeded `dispatchOrder`) and empty `responses/`,
`traces/`, `observations/`, `scores/`.

**2. Dispatch.** Send each `requests/<id>.md`, in `dispatchOrder`, to a fresh
agent with no other context — one request per agent. A request file contains
the harness note (fresh agent; do not read `eval/edit-arms/`; scratch
directory; run Agentic Mermaid with `AM_TRACE_LOG=<run-dir>/traces/<id>.jsonl`),
the user's request, the diagram, the arm's Tools section and the response
contract. Suggested dispatch prompt for an in-checkout subagent:

```
Read <run-dir>/requests/<id>.md and follow it as a normal coding agent working
in this repository. Return ONLY your final reply (the "Updated Mermaid" and
"Notes" sections). Do not modify project files.
```

Record the agent's complete final message (finalize extracts the fenced block
under "Updated Mermaid", else the last ```mermaid fence):

```sh
bun run eval:edit-arms -- record --run-dir <run-dir> --request <id> --response-file <file>
```

Optionally write runner-observed cost for the request to
`observations/<id>.json`: `{ "inputTokens": n, "outputTokens": n, "turns": n,
"wallMs": n }` (missing values stay unavailable, never zero).

**3. Finalize and report.**

```sh
bun run eval:edit-arms -- finalize --run-dir <run-dir>          # scores/<id>.json + summary.json
bun run eval:edit-arms -- report --run-dirs <dir1>,<dir2>,<dir3> --out <file>  # pooled + per model + decision rule
```

`finalize` exits nonzero while any request is uncaptured. It refuses to score
a run prepared against a different corpus revision.

**Cost estimate.** `bun run eval:edit-arms -- cost --arms A,B --runs 1
--sample 10` prints the request sizes and the token estimate under the stated
per-run assumption (see PREREGISTRATION.md §8).

## Limitations

- The agents run inside this checkout, so they can discover tooling beyond
  their arm; compliance is observed from `AM_TRACE_LOG` and reported, and
  analysis is intention-to-treat. For strict blinding to the answer key,
  prepare and dispatch from a clone without `eval/edit-arms/corpus/tasks.json`
  available to the agent.
- Preservation is measured on the returned text, so transcription slips
  (e.g. a dropped trailing space) count against both arms alike.
- One author wrote all requests and references. Requests name the exact text
  and, where it matters, the group or arrow style, so the oracle can be strict;
  this makes the tasks more specified than many real requests.
- Informational, measured with Agentic Mermaid at `825befd5` and not used in
  scoring: 39 of 41 held-out diagrams parse to a structured (typed-editable)
  body; `k8s-contribution-methods` and `fluid-remote-message-processor` are
  opaque. Agentic Mermaid fails to verify two diagrams that Mermaid 12.2.0
  accepts (`fluid-remote-message-processor`, dotted state ids;
  `airflow-dagrun-metrics`, a `2min` duration). Both arms meet those failures
  when they verify. `am mutate` re-serializes a structured body canonically
  (`--preserve-source` applies only to opaque bodies), so arm B's preservation
  depends on whether agents keep that output or patch the original text.

## Pilot (2026-11-13) and why the full run is deferred

Ten seed-1 tasks × arms A and B × one run, dispatched to fresh Claude Sonnet
subagents (exploratory, not the preregistered confirmatory run):

| Arm | Success | Collateral damage | Untouched lines preserved |
| --- | ---: | ---: | ---: |
| A — text edit + verify | 10/10 | 0/10 | 100% |
| B — typed path | 8/10 | 2/10 | 33% (comments 0%) |

B − A preservation was −67 points (bootstrap 95% CI −88 to −43); the damage
difference (+20 points, CI 0 to +50) does not exclude zero at this size. Both
damaged B runs come from re-serialization, not from the model: `am mutate`
writes structured bodies canonically and `--preserve-source` refuses them, so
one run rewrote a quoted subgraph title into a new subgraph identity and the
other wrote `<` as `#lt;` (displayed the same, recorded differently by
Mermaid). Every B run dropped the diagram's comments.

The confirmatory run is deferred: the pilot already shows the typed path losing
on the primary metric for a known, fixable reason, so its result is predictable
until typed edits preserve untouched source. Rerun this pilot after that change
as the acceptance check. Cost note: pilot runs averaged ~77k tokens, almost all
of it the Claude Code subagent's fixed context rather than the task; a runner
that calls a model API with only the request file would cost a fraction of that,
so re-estimate before any full run.
