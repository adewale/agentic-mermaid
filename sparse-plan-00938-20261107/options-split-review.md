# Declarative option-contract split review

Read-only review of the current working diff against00938cc04. No source edits,
builds, tests, renders or profile replays. **No actionable correctness finding.**
Payload savings and exact-head qualification remain pending coordinator checks.

The relocated block from `NON_SERIALIZABLE_RENDER_OPTION_FIELDS` through
`styleInputJsonSchema` is byte-exact against00938 after normalizing only the
three formerly private declarations now exported to their internal leaf
consumers. The remaining render-contract tail from ResolvedAppearance onward
is likewise byte-exact. This is a dependency split, not a reimplementation of
validation or request admission.

- The root explicitly reexports the same17 formerly public declarations.
  `JSON_VALUE_SCHEMA`, `renderOptionsAdmissionMessages` and `JsonSchemaNode`
  are not newly exposed through it. Public index/browser barrels still use the
  root's existing explicit exports; package exports do not add a leaf subpath.
- The manifest, frozen field arrays and `validationRootSchema` singleton now
  have one canonical leaf owner. Root imports/reexports are live references,
  not copies; the facade and shared-option projection import that same module.
  There is no second schema or duplicate registry/cache state.
- Typed request callback admission, captured style references, bounded immutable
  snapshots, CAPTURED_OPTIONS membership, text-profile execution and request
  cache custody remain in root unchanged. The JSON validator still rejects
  nonserializable fields; the shared-option projection still deliberately
  retains the callback field for typed transports. Source normalization and
  backend capability negotiation have not been moved into the facade.
- Runtime leaf dependencies are declarative style/schema/CSS/JSON helpers.
  Their current runtime imports do not point back into the new leaf or request
  waist, so no new cycle or partially initialized manifest was found. Style
  validation still resolves the same canonical style registry. Graphical entry
  `graphical-render.ts` retains default-backend registration; the engine-free
  facade no longer acquires the execution backend through this import.
- Build projection now processes the actual canonical manifest owner. Its AST
  matching is declaration-name based, so the path change preserves metadata
  removal, schemaDocumentation and terminalAdapter independence, validation
  expectations, minimums and authored schema properties. The root is processed
  only for its pre-existing optional family-diagnostics coalescing. With that
  option off it falls through to the normal loader; with it on, the strict
  family-diagnostics import replacement still targets the unchanged import.
  The existing fixture path update follows the owning module and preserves its
  assertions rather than weakening the oracle.

The split should remove an unnecessary backend dependency from the facade,
while actual source/options/output execution remains in the worker. This source
review does not establish compressed savings, successful startup, option/error
parity across built module graphs or first-use latency. Existing owner tests,
types, build projections and complete standalone gzip/Brotli measurements are
being run by the coordinator; none is represented as completed here. The stopped
XML streaming prototype remains outside this production diff.
