CHANGES_REQUIRED

- **USF-249-01 — P1: branch-free adapters are not sufficient evidence for factored route conformance.**  
  Evidence: `docs/project/issue-248-fidelity-delivery-plan.md:346-360,390-398` permits a small cross-family fixture set when an adapter has no family/construct branch. Yet `src/cli/index.ts:689-693` documents a real family-specific Timeline semantic change caused by generic parse/reserialize behavior without such branching. This criterion can therefore let source/config normalization, encoding, truncation, or diagnostic projection corrupt selected constructs while all route fixtures pass.  
  Smallest correction: require factored adapters to prove an information-preserving typed projection for every accepted input class—byte-preserving source/payload pass-through, or a declared normalization with property/metamorphic preservation checks. Treat any unproven transformation as route-specific for the affected input category. This preserves the factored architecture without adding construct × route coverage.

- **USF-249-02 — P1: the dependency graph contradicts the claim that general receipt aggregation is independent of PR #192.**  
  Evidence: `docs/project/issue-248-fidelity-delivery-plan.md:39-50` says capability/citizenship aggregation can proceed without #192. However, `:600-605` defines A3 as the complete-family projector package and makes its Sankey shard depend on C3; `:622-631` then places A4 strictly after A3; `:634-637` reinforces that ordering. Thus A4 is transitively blocked on Sankey enrollment/#192 even though A4’s transitional downgrade model is general work. Live #192 remains a separate open head, `84848d507a18280224bbf186f7e74a4e18ceb972`, albeit now rebased and green.  
  Smallest correction: split A3 into an existing-15 prerequisite and a Sankey shard. Gate A4 on A3.0 plus the 15-family projector closure, recording Sankey as absent/blocked; gate only C4 and final 16-family closure on the Sankey projector. Alternatively, narrow the independence claim.

- **USF-249-03 — P1: mutation/build preservation is no longer exact-set complete per structured construct.**  
  Evidence: live issue #248’s “Mutation and sabotage testing” requires every structured syntax construct to have at least one mutation that preserves unrelated constructs. The candidate’s `:383-408` requires preservation only when a mutation/build semantic cell is declared, while `:963-966` closes only “applicable” routes. Nothing prevents omitting the cell or declaring it not applicable for a construct even when that family has a real public mutation path. A construct can therefore parse natively yet be silently lost when another construct is mutated.  
  Smallest correction: require each structured construct/source membership accepted by a family’s mutation surface to participate in at least one real-route mutation invocation, with a result oracle and unrelated-facet preservation oracle. Permit `not-applicable` only when no relevant public family operation exists, with authority evidence. Apply the analogous rule to buildable construct/operation pairs. One canonical invocation per construct plus factored route conformance avoids a route Cartesian product.

- **USF-249-04 — P2: the visual-evidence rule is unexecutable for a replacement Sankey enrollment based on `main`.**  
  Evidence: `:62-67,680-683` permits a new C3 enrollment from `main`, where Sankey is unsupported, but `:845-847` unconditionally requires before/after visual evidence. Such a base cannot truthfully generate a before render.  
  Smallest correction: require same-input base/head images only when both revisions render; for newly supported surfaces, preserve the exact base error/unsupported receipt and provide the head image without fabricating a baseline.

Tested non-findings:

- The immutable tuple matches: repository ID, target/base `f203ab6a…`, head `cf0ad902…`, tree `a7bc33eb…`, binary diff hash `e09d1db9…`, and semantic title/body hash `1c8a4cf…`. The worktree is clean and the diff is exactly one 1,011-line document.
- Live CI and Ruff runs are successful on the exact head.
- Every confirmed family finding in #248 is assigned to Phase 0, Phase 1, or Stack C; no defect-table family was omitted.
- Upstream revision closure, opaque/native aggregation, official-fence enumeration, config/theme leaf ownership, projectors, diagnostics, and public mutation/build execution are otherwise fail-closed.
- Mermaid 11.16 locally confirms Sankey trim-before-identity, rejection of colon-suffixed headers, user-space source/target gradients, and multiply compositing. Live #192 includes focused tests for those behaviors, including the documented dark-background compositing divergence.
- Residual risk: the manual bootstrap’s external artifact authenticity and human-witness steps cannot be established from this repository-only audit.
