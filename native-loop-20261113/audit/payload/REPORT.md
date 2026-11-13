# Fetched module ownership and remaining payload work

Source689 browser artifacts were fetched from the prior durable evidence checkpoint `7e24482a`, then every actual product module's SHA256 was matched against the recovered canonical local browser package. This reuses the original old-host observations; it is not a new browser timing or network measurement. See `frozen-flow-pr-agentic.json`, `frozen-flow-pr-elk.json` and `FLOW-MODULE-OWNERSHIP.json`.

The plain Flowchart closures share311,931gzip bytes. Native adds six modules totaling67,306gzip bytes; ELK adds its one428,435gzip implementation. Thus the observed379,237/740,366byte totals and32/27requests follow actual dependency ownership. They are not duplicated copies of the same solver:

| Native-only fetched module | gzip bytes | Other static consumers |
|---|---:|---|
| Native producer/core | 52,144 | demanded implementation |
| shared forest implementation | 2,353 | implicit forest path via its loader |
| measured backend contract | 739 | Requirement |
| compound obstacle/visibility support | 4,924 | Swimlane |
| measured route safety | 6,925 | Class, Swimlane, obstacle support |
| orthogonal simplifier | 221 | Usecase, Class, Swimlane, obstacle support |

The source owners are `layout/agentic-layered.lazy.ts`, `forest-loader.lazy.ts`, `forest-implementation.ts`, `measured-backend.ts`, `compound-obstacle-index.ts`, `measured-route-safety.ts` and `compound-visibility.ts`; the JSON retains exact emitted importers. Module descriptions identify their relevant source responsibilities, not a recovered complete sourcemap inventory.

The existing build consolidator already merges the static intersection of all family closures while preserving lazy providers and live ESM bindings (`scripts/build/consolidate-browser-runtime.ts`). Blindly merging the221byte simplifier into the measured route-safety chunk would make ELK Usecase acquire a module it currently does not import. Combining obstacle support with route safety would similarly add dependencies to Class. Forest is also used by the implicit forest path, so merging it into the entire Native implementation can impose a much larger new dependency. No free request reduction is demonstrated by those moves; do not repeat a loader rewrite on filenames alone.

The761,500gzip figure is the existing Flowchart ceiling in `scripts/build/browser-lazy-budgets.json`, not a measured ELK comparator. `browser-lazy-report.ts` forms that budgeted closure from static family code plus conditional YAML and ELK constructor demand. The reported781,054>761,500 failure is therefore a default/conditional-dependency budget obligation, separate from the plain measured Native/ELK table. Demo302,500 and editor1,334,500 are likewise ceilings, not alternative engine measurements. Preserve all ceilings.

The next useful payload subtraction needs an actual shared runtime responsibility that can be deleted or deferred without changing the output/security/receipt contract. The three largest shared chunks contribute183,080+45,003+40,351gzip bytes of the common311,931byte closure. Their size alone does not justify omitting actual writer/capture/validation owners. A runtime simplification at an already demonstrated shared authority can benefit both payload and full-consumption cost; confirm its exact built module delta and all33 family/styled/request closures. No additional build, framework, cache, backend or payload change was introduced by this audit.
