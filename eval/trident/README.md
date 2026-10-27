# Trident benchmarks

Shared benchmark runners, community comparisons and retained-evidence tooling
belong to [Trident](https://github.com/adewale/trident). Agentic keeps its product
contracts and Mermaid compatibility policy.

The local launcher uses the Trident revision in `config.json`. Benchmark runs
remain excluded from CI and the published library. The launcher supplies this
checkout as the source target; Trident prepares its own source-adapter workspace
from public tracked inputs. Benchmark records belong outside that disposable
workspace so updating the harness cannot remove measurement evidence.

```sh
bun run bench --list --profile full
bun run bench:families --profile smoke
bun run bench:portable:build
```

On first use the launcher fetches the exact public Git commit and installs its
locked dependencies under ignored `bench-report/.trident/`. Alternatively,
install that revision yourself and set `TRIDENT_ROOT=/path/to/trident`.
A different revision is rejected before the tool runs. All other arguments and
exit status pass through to Trident. Full source checks use `bench:test` and
`bench:typecheck`; their test fixtures do not constitute benchmark measurements.

The generated source workspace uses this checkout's tracked files and Trident's
protocols. It records both original revisions and the combined driver revision.
Do not put evidence inside that disposable workspace; default records live in
this checkout's ignored `bench-report/` and explicit output paths remain external.
Agentic keeps only its pinned launcher, product-specific fixtures and regression checks.
Timing, peer discovery/catalogs, external editor comparison and evidence reporting
belong to Trident. Inside its source workspace, `eval/benchmark` is Trident.
Use `bun run bench --suites palette-performance`,
`bun eval/trident/run.ts source bench:endpoint-marker BASE HEAD OUT`, and
`bun eval/trident/run.ts source bench:modern-summary EVIDENCE_DIRECTORY`.
Shared harness fixes belong in Trident.
