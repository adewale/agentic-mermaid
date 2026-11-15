# Shared Trident library

Agentic Mermaid owns its product benchmarks under `eval/benchmark`: family and
operation witnesses, invocation/MCP/editor coverage, profiling, release and peer
budgets, private corpus generation and the build/pack Davebench wrapper.
See [questions, value and limitations](../benchmark/BENCHMARKS.md).

Trident owns public-artifact comparisons, independent oracle and fidelity
observers, portable workloads, statistics, resources and retained reports.
Agentic receives the same catalog-release/candidate rules as every other project.

`bun eval/trident/prepare.ts` fetches the exact Git revision in `config.json`,
checks its identity and clean tracked files, installs locked dependencies, and
links the library and its development tools into the benchmark package.
Alternatively set `TRIDENT_ROOT` to an installed clean checkout of that exact pin.
The links and cache are ignored. No product files are copied into Trident and no
synthetic product workspace is assembled. Preparation/typechecking may run in CI;
measurements remain local-only. Nothing here enters the published AM package.

```sh
bun run bench --list --profile full
bun run bench:all --rounds 5 --out /evidence/agentic
bun run bench:test
bun run bench:typecheck
bun run bench:community:update --projects adewale/agentic-mermaid --profile full --rounds 5 --out /evidence/public
```

The source command bootstraps shared code before loading a runner. The canonical
repository typecheck also prepares it so returned source runners remain checked.
Public comparisons delegate through `eval/trident/run.ts`. Keep measured evidence
in ignored `bench-report/` or an external directory; do not commit derived results.
