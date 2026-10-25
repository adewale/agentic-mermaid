# Local Mermaid benchmarks

This directory owns the performance runners, community adapters, result
qualification, records and reporting tools. The private package is not a root
workspace member and is not shipped in the Agentic Mermaid npm artifact.
Benchmarks are excluded from CI, including scheduled and hosted manual runs.
The former release benchmark workflow and its publication dependency are removed.

From the repository root:

```sh
bun run bench:test
bun run bench:typecheck
bun run bench:lint
bun run bench -- --list --profile full
bun run bench:community:update -- --help
```

The private package exposes the same checks through `bun run --cwd eval/benchmark
test`, `typecheck` and `lint`. Its own `package.json` declares the directly used
benchmark libraries; Python charts use `requirements.txt`. An existing root
installation can provide these dependencies during development. A separate
installation can be made in this directory without changing the product lock.
Install browser executables and language toolchains only for the selected lanes.

Product test discovery stays in `src/__tests__` plus the existing family-usage
contract. Benchmark controller tests are under `tests/`, outside that discovery.
The product's repository typecheck and lint exclude this directory; the explicit
benchmark commands own its checks. A shared deterministic graph fixture lives
under `eval/shared` so product route contracts do not import benchmark code.
Correctness tests that also appear in a benchmark campaign remain ordinary
product CI tests; selecting them in a local campaign does not turn them into
timing gates.

Measured entry points reject `CI` and supported hosted-CI indicators before
starting work. Reporting tools can still consume existing evidence without
launching benchmark workers. There is no CI override flag.

## Update one community project

Edit that project's pin or adapter in `docs/mermaid-community.json`, or resolve
its newer published version under the existing version policy. Commit protocol
code before timing: a Git object must identify the code that actually ran.

```sh
bun run bench:community:update -- \
  --projects obsidianmd/pele \
  --profile full --rounds 3 \
  --records bench-report/project-records \
  --out bench-report/community-updates \
  --markdown docs/community-benchmark-ranking.md
```

`--projects` accepts comma-separated catalog IDs and filters acquisition before
any unrelated project is prepared. Omit it to check the whole catalog. The
default `bench:community` and unified `community` suite use the same retained
records. The following `community-cli` suite consumes the CLI results published
by that same controller invocation, rather than timing the projects twice.

The update command resolves and prepares selected artifacts, then compares their
complete measurement identity with retained attempts. Matching records skip both
API/browser and supplemental CLI clocks, including failed results. `--force`
explicitly creates a new attempt. `--plan` performs preparation and prints the
reuse/measure decisions without starting clocks; preparation may download or build
the selected project. Frozen preparation/input/browser flags remain available.

Reuse binds shipped bytes and installed dependencies, browser/native CLI bytes,
adapter configuration, committed protocol code, literal inputs and assertions,
runtime versions, environment, machine and sampling policy. A changed shared
protocol or cohort invalidates affected records even when a project is unchanged.
Catalog prose and unrelated Agentic Mermaid source changes do not by themselves
invalidate peer timings. Raw evidence must remain present. Records keep the
original observation dates; a reused failure remains a failure.

The store retains immutable attempts and atomically selects the current attempt
for each project. A cached older version can become current without erasing the
newer attempt. The Markdown command replaces only its marked rolling-record
section, preserving dated historical tables. Ranks compare matching contexts
and remain separate by output and invocation boundary. Rolling ranks do not
provide paired same-session evidence for small performance differences.

Keep the records directory **and** the referenced evidence directories. Missing
evidence prevents reuse and is excluded from ranks; an unrelated missing record
does not stop a selected project's update. A campaign lock serializes preparation
and timing against their shared cache. After an interrupted process, verify that
its recorded PID has stopped before removing a leftover `project-campaign.lock`.

The cache is currently specific to the community API/browser/CLI campaign.
Explicitly invoking a legacy Dave, release, PR or source-diagnostic runner starts
its owning protocol again; paired controls are intentionally part of those
experiments. Historical reports are retained as historical evidence and are not
silently admitted into the new cache under a different protocol.

## Extraction boundary

The generic controller, artifact records, community adapters, worker evidence,
qualification and reports live together here. The existing Agentic Mermaid
adapter still has these explicit repository dependencies:

| Dependency | Why it remains | Extraction work |
| --- | --- | --- |
| Built package/archive, native executable and built website | Public invocation and delivery measurements | Pass explicit artifact roots; keep the product build outside the benchmark package. |
| Source imports in source-stage/family adapters | Layout stage attribution, family metadata, direct functionality | Replace these owning adapters with a versioned Agentic Mermaid adapter in the extracted project. |
| `eval/shared`, imported corpora and reviewed policy documents | Independently expected inputs and pinned reference scope | Move reviewed data with its provenance or load it from an explicit fixture root. |
| `src/__tests__`, `e2e` and other `eval` suites | Existing owning correctness checks orchestrated as external processes | Keep these as optional repository commands rather than copying their implementation. |
| Two forwarding modules under `tests/helpers` | Existing temporary-directory and child cleanup behavior | Replace those two test-support seams when moving the package. |
| Git checkout and root package scripts | Source identity, legacy suite discovery and command cwd | Supply the repository adapter root; `AM_BENCH_REPOSITORY_ROOT` controls the local package-command cwd. |

These dependencies mean copying the directory alone does not yet make every
source diagnostic runnable. Public artifact comparisons and project records
have different prerequisites from source-stage diagnostics; missing adapters
must remain blocked. Product runtime code does not import benchmark modules.

See the [unified runner](unified/README.md) for the complete suite selection and
evidence protocol. Historical reports may describe the removed hosted benchmark
workflow; their recorded observations are unchanged.

The [inventory](INVENTORY.md) lists all suites and standalone evaluations. The
[assessment](ASSESSMENT.md) separates measured coverage from remaining gaps.
