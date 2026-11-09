# Independent frozen-cohort acquisition review

Read-only review of measure.mjs, run.py, CASES.json and all 90 job configurations. Compared the 30 cases to the retained FIDELITY-CASES.json selected cohort and checked job sources, target options, literal preludes, edit sources/options and phases. No rendering, profiling, tests, builds, network, source edits or agents. At inspection the ledger contained 19 completed processes with zero nonzero process exits; that is progress only, not completion of the planned run.

**No acquisition blocker found, subject to the reporting distinctions below.** This is the first complete frozen-30 cost acquisition, not an optimization result or new fidelity validation.

## Capture equivalence and timing

CASES.json exactly matches the frozen selected cohort. Every target job retains its authored/default options, sets the selected backend with fallback none, and sets embedFontImport false. Prelude source/options remain literal and untimed, without imposing the target backend. Exactly seven original authored edits receive edit/edit2 calls; edit-level renderOptions override the base options correctly, including the original invalid fontSize 14→24 inputs. The other 23 cases receive no invented edit. Cold/first-target and repeat1/repeat2 exist in every cell.

The runner schedules 30 cases × three backends × two cache modes × two fresh-process replicas = 360 serial Node processes. That implies 1,248 planned timed calls: 360 first-target, 720 repeated-target, and 168 authored-edit calls. Imports and TypeScript transformation are outside render windows. Full SVG and entire receipt serialization and product-byte counting occur inside consume; receipt serialization is performed separately and again as part of whole-product JSON counting. This is the existing full-product cost boundary, not pure layout/kernel time. Error construction/stack materialization in catch is part of the timed refusal path and must not be compared as equivalent completed delivery.

Compression, artifact writes, explicit GC and cache audit are outside target timing. With profile:false and observers:false in all jobs, no Profiler.start or timed render-stage/performance observer executes. The harness still connects/enables the inspector before targets; that common harness setup is not module-free/application startup. Zero-time profile artifact placeholders are not actual sampled CPU profiles. The reported samplingIntervalUs=200 is a configured interval, not evidence that sampling took place.

A first-target call after literal preludes is preconditioned by those renders and may already have warm modules, fonts, configuration and caches. Even without preludes, module import and inspector setup precede it. Use “first target in a fresh process” / “preconditioned first target” rather than universal cold startup. Repeat1 and repeat2 share a process, warmup product and runtime caches; edit2 repeats the same edited input. They are correlated observations, not independent process replicas.

## Memory and cache interpretation

before/after memoryUsage snapshots are process snapshots, not peak allocation during a call and not retained-result size. Later windows follow explicit GC; the first-target window does not, so raw deltas across these phase types are not equivalent allocation measurements. A negative heap delta is possible and is not negative resource cost. The original warmup SVG/receipt remain live to support exact comparisons; later retained proof rows and harness/import state also contribute.

resourceUsage().maxRSS is the process lifetime high-water mark in the current Linux environment. It includes import/transformation, inspector, preludes and earlier compression/artifact work, and cannot be reset for each render. A later row's peak is not attributable to that one call or the selected solver alone. Do not sum per-row peaks or call it browser/editor/package memory. process.cpuUsage is process CPU, not an isolated solver or guaranteed wall-time equivalent.

The cache mode is the existing AGENTIC_MERMAID_ELK_CACHE environment switch. It does not itself prove that every unrelated cache or module initialization is disabled; each artifact records a separate untimed cache audit. Preserve the mode and actual receipt/backend decisions, including families where selecting a graph backend does not imply that kernel executed.

## Status, determinism and fidelity

Keep invalid fontSize failures, explicit Trinity image refusal and returned Native/ELK placeholders as distinct outcomes. Neither process exit zero nor a returned SVG proves decoded-image fidelity. A caught expected product error can coexist with a successful collector process. The failure name/message retained by the collector allow capability refusals to be distinguished from other errors; do not collapse them into successful timings or compute refused-versus-completed speed ratios.

The existing repeat equality expressions can evaluate true when both product and warmup are absent (`undefined === undefined`). Therefore inspect wholeSvgExactWarmup / entireReceiptExactWarmup only when both relevant calls returned. A true equality flag on two error rows is not determinism or fidelity evidence. Similarly, editChanged says only whether whole SVG bytes differ from warmup; it does not validate authored meaning. Untimed cache audit is diagnostic and must not be pooled into measured rows.

Two process replicas per backend/cache/case and two correlated repeat calls are descriptive coverage, not a stable latency distribution or strong statistical significance. Backend order alternates ELK/Native endpoints while Trinity remains in the middle; this mitigates some ordering drift but is not randomized experimentation. Preserve per-case/mode/phase results and sample counts. Any combined cost comparison must use matched completed workflows and retain refusal/timeout counts separately; do not hide unavailable cases behind an aggregate win.

## Provenance and completion limits

The inspected checkout HEAD is 3f2c26bd8, matching run.py's stated full source revision. The loader reads that live checkout separately in each fresh process; the hardcoded ledger revision is a label rather than a source freeze mechanism. The coordinator's sole-writer/unchanged-runtime lease is therefore the provenance basis during capture. No source hashing or new source-presence gate is proposed. ImportMs identifies fresh Node source loading with this transform hook, not compressed shipped bundle startup.

A 90-second subprocess timeout is a bounded acquisition failure, not a layout refusal; retain partial rows/logs and exclude incomplete cells from success ratios. The deadline check stops new processes at 20:00 UTC rather than guaranteeing a process already started has finished by then. Record actual completed process/call counts and terminal status before presenting complete coverage. The current acquisition does not change runtime code, original caps/defaults/versions, prior validation progress, bundle readiness or Trinity replacement readiness.
