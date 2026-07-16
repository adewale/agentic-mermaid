# Homepage-coverage eval

**Question:** given *only* the URL <https://agentic-mermaid.dev/>, can a model
(e.g. Haiku, GPT-5-mini) discover one of the agentic interfaces and then

1. author **one instance of every diagram family**, and
2. exercise **every built-in Style and every built-in Palette**?

This is a breadth/discovery eval — the complement to `eval/agent-usage/`, which
measures the *safe-editing loop* on individual tasks. Here we measure whether a
model, handed nothing but the homepage URL, can find its way onto an interface
and cover the whole surface.

## What "confirm" means here

The model under test returns a single JSON **coverage manifest**:

```json
{
  "interface": "sdk" | "cli" | "mcp",
  "families": { "<familyId>": "<mermaid source>" },
  "styles":   { "<styleName>":   { "source": "<mermaid source>" } },
  "palettes": { "<paletteName>": { "source": "<mermaid source>" } }
}
```

The deterministic oracle (`oracle.ts`) re-derives every claim against the shipped
SDK — it never trusts the model's word:

| Criterion | How it is graded |
|---|---|
| **Discovered an interface** | `interface` ∈ `{sdk, cli, mcp}` — the channels `start.md` advertises. |
| **An instance of each family** | each family source **parses**, **verifies**, narrows **structured** via its `as*` helper (an opaque body renders but is not editable), and is that **exact family**. |
| **Exercised the Styles & Palettes** | the oracle itself re-renders each probe under the named look and checks the SVG is produced and **self-contained** (`verifyNoExternalRefs`). |

Because the oracle re-verifies, a model can't pass by hallucinating: non-parsing
source, an opaque body, a wrong-family diagram, or a fabricated Style name all
fail. Producing structured, correct instances across the non-flowchart families
(whose syntax is *not* guessable) is exactly the signal that the model really
discovered the interface and read the discovery envelope.

The roster is read live from the shipped registries (`roster.ts`), so it never
drifts from the product: add a family, look, or palette and the eval requires it.
Today that is **15 families, 16 Styles, 20 Palettes**.

## Running it

### Reference (deterministic)

`reference.ts` is the "ideal agent": it authors each family's own shipped
`example` and a render probe for every look. It proves the surface is fully
coverable and is the deterministic green baseline the self-check replays.

```sh
bun run eval/homepage-coverage/live.ts --record-reference   # (re)write the committed transcript
```

Regenerate the committed transcript after the roster grows (the self-check tells
you when the stored snapshot no longer matches the registries).

### Live model arms (on-demand, need credentials)

```sh
# Faithful discovery arm — needs a browsing/tool-capable endpoint (subagent harness):
bun run eval/homepage-coverage/live.ts --provider anthropic --model claude-haiku-4-5 --discovery browsing

# Chat-API capability arm — the runner fetches the discovery docs over the network
# and includes them, so a plain chat completion can attempt the task:
bun run eval/homepage-coverage/live.ts --provider openai-compatible --model gpt-5-mini --discovery preflight
```

Provider plumbing (`--provider`, `--model`, `--api-key`, `--base-url`, env keys)
is shared with `eval/agent-usage/live.ts`. Each run writes
`transcripts/<provider>-<timestamp>/{transcript,summary}.json`.

## Honest limitations (read before quoting a result)

- The committed transcript is the **deterministic reference**, not a live model.
  It confirms the surface is coverable and that the instrument grades correctly.
  A real Haiku / GPT-5-mini pass is captured on-demand (credentials required) and
  committed alongside as its own transcript, exactly like `eval/agent-usage`.
- `--discovery browsing` is the faithful "given just the URL" test: the model
  must fetch `/start.md`, `/capabilities.json`, and list the styles itself. It
  needs an endpoint that can browse and run tools.
- `--discovery preflight` pre-satisfies discovery (the runner fetches the docs),
  so it measures **authoring coverage**, not discovery. Label results accordingly.
- Subagents launched inside a checkout of this repo can self-discover the local
  tooling, so treat any in-repo subagent pass as an upper bound.

## Validation

```sh
bun run eval/homepage-coverage/check.ts
```

`check.ts` pins the roster to the shipped registries, grades the reference to
full coverage, proves the oracle rejects dropped/opaque/wrong-family/
unrenderable/bad-interface manifests, exercises the live runner's manifest
extraction, and replays the committed transcript. It exits nonzero on any
failure.

It deliberately lives under `eval/` rather than as a `src/__tests__/` test: the
repo's evidence-provenance receipts (e.g. `eval/pie-highlightslice`,
`eval/mermaid-doc-showcase`) hash **every** `src/**/*.ts` file, so adding a test
there would drift unrelated, browser-rendered PNG evidence. Keeping the check
under `eval/` leaves those receipts untouched.

## Files

- `roster.ts` — the coverage roster, read live from the SDK registries.
- `oracle.ts` — `gradeCoverage(manifest)`, the deterministic grader + types.
- `reference.ts` — `referenceCoverageManifest()`, the ideal-agent baseline.
- `live.ts` — the runner: `--record-reference` and the live model arms.
- `check.ts` — the self-validation described above.
- `transcripts/reference/` — the committed deterministic reference transcript.
