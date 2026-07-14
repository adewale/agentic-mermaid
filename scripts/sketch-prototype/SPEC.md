# Hand-rendered style prototype — historical record

> **Status: non-authoritative research artifact.** This file is not a product
> specification, implementation plan, roadmap, or backlog. The prototype code
> and style data in this directory remain only as reproducible research
> fixtures; their names do not imply supported or scheduled product features.

The prototype established that deterministic hand-rendered SVG could work
across the then-supported diagram families. It deliberately rewrote completed
SVG and therefore does not define the production architecture or public API.
In particular, it does not define public backend selection, a Scene schema,
rollout phases, or candidate styles.

Current authorities are:

- [`TODO.md`](../../TODO.md), the only scheduled-work backlog;
- [`docs/project/brand-primitives-plan.md`](../../docs/project/brand-primitives-plan.md),
  the customization architecture and Section B design;
- [`docs/project/archive/section-a-rendering-contract-2026-07.md`](../../docs/project/archive/section-a-rendering-contract-2026-07.md),
  the open Section A landing record until its PR merges; and
- the generated Section A capability report and executable registries for the
  current implementation contract.

For production behavior, inspect `src/scene/`, the family registry, and their
conformance tests. Historical research details can be recovered from Git
history when needed; keeping a second live-looking specification here caused
API, phase-status, and backlog drift.
