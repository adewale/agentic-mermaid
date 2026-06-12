# Family-usage results

## ⚠️ Caveat — this is a SMOKE run, not the decision corpus

The decision-grade corpus for "which family do people use most" is **READMEs from
popular GitHub repositories**. Producing it needs network access this environment
does not have. The numbers below are a **smoke run over the markdown that ships in
this repo** (`docs/` + `skills/`, which includes the upstream reference material
under `skills/.../references/upstream/`). That material is a Mermaid *feature
catalogue*, not real-world consumer usage, so it deliberately over-represents
exotic and beta families. **Do not treat this ranking as the BUILD-5 family
decision.** See `README.md` for how to run the real corpus.

These numbers are reproducible offline:

```bash
bun run eval/family-usage/count.ts docs skills
```

## Smoke run

- Corpus: this repo's `docs/` + `skills/` markdown
- Files scanned: 65
- Mermaid blocks: 964
- Counter: `eval/family-usage/count.ts` (deterministic; tied ranks broken
  alphabetically)

The four BUILD-5 candidate families, in this smoke corpus:

| Family   | Count | Share |
| -------- | ----: | ----: |
| gitgraph |    72 |  7.5% |
| mindmap  |    26 |  2.7% |
| gantt    |    22 |  2.3% |
| pie      |     8 |  0.8% |

Full top of the ranking (for context — note the `other:*` buckets are families
this renderer does not model, surfaced rather than dropped):

```
   1  flowchart            229   23.8%
   2  sequence              81    8.4%
   3  class                 73    7.6%
   4  gitgraph              72    7.5%
   5  block                 60    6.2%
   6  state                 41    4.3%
   7  other:wardley-beta    38    3.9%
   8  er                    35    3.6%
   9  other:zenuml          32    3.3%
  10  timeline              29    3.0%
  ...
  24  pie                    8    0.8%
```

## Reading this for BUILD-5

Two things are true at once:

1. **In this (non-representative) smoke corpus, pie is the *least* used of the
   four candidates.** That is expected — the upstream reference docs we scanned
   weight every feature roughly equally and add a long tail of beta families, so
   raw counts here do not reflect what a typical repo README uses.

2. **Pie was nonetheless chosen as the first BUILD-5 slice on a different axis:
   implementation cost.** Pie has the smallest, most self-contained grammar of
   the four (`pie [showData]`, optional `title`, `"label" : number` entries — no
   dates, no nesting, no commit graph). It is the cheapest end-to-end target and
   the best vehicle to land the family-addition machinery (routing, agent
   surface, goldens, docs sync) with minimal grammar risk. The ranking that
   should drive *subsequent* slices (gantt vs mindmap vs gitgraph) needs the real
   README corpus — this file does not assert that order.

The honest summary: **cost picked pie first; the real usage corpus (network
required) must pick the ordering of the remaining three.**
