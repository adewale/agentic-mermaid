# Issue #88: minimal route-hitch closure decision

Issue #88 contains two independent questions: residual `ROUTE_HITCH` findings after late edge/label repair, and whether a degenerate 4 px node canyon should create a new global spacing invariant. This change fixes the former and deliberately declines the latter. It does not introduce an arrowhead-incidence contract.

## Decision

After all existing late edge and label passes settle, rerun the existing direct-lane proof in a monotone closer:

1. the producer and final auditor build the same lane/port-occupancy context;
2. only an edge that the final hitch proof already accepts is straightened;
3. each accepted mutation removes a bend and no mutation adds one;
4. the changed edge receives a fresh route certificate;
5. a second closure is a geometry no-op.

The loop therefore terminates after at most the number of edges. No new route search, shape model, marker geometry, endpoint angle, renderer path, or public contract is added.

The 2,800 deterministic `denseDag` + `diamondFan` corpus reports 19 hitch cases on `main` at `027cb4b0`; this patch leaves zero. They fall into two causal buckets:

- **Late closures:** six cases need geometry repair (`denseDag` seeds 363, 1656, 1768, 1938, and 1952; `diamondFan` seed 373). The fixed point straightens seven routes because closing `N3->N4` in seed 363 makes a second route provable on the next scan.
- **Proof-context corrections:** the other thirteen cases retain their geometry. They were false positives caused by the final auditor and route producer using different bundle/port occupancy or by the old audit ignoring settled rendered-label halos. For example, `diamondFan` seed 269 has only about 12.5 px between two label pills: the earlier 2 px proof clearance admitted the direct candidate, while the final 8 px halo on each pill correctly rejects it.

On the same Apple M2 Ultra/Bun 1.3.13 checkout, one sequential corpus traversal measured 16.184 s before and 16.468 s after (+0.284 s, 1.8%). These timings are diagnostic, not a CI threshold.

## Minimum-gap policy

`nodeSpacing` remains an input to ELK's primary layout, and a repair that directly separates an overlapping pair continues to apply its existing local spacing. We do **not** add a post-layout all-pairs minimum-gap pass.

A global pass would be a new constrained packing problem: moving one box to widen a 4 px canyon can violate rank alignment, group containment, link-rank distance, or a different pair's spacing and can cascade across the drawing. The reported canyon is overlap-free, route-clean, and restricted to degenerate generated input. Without user evidence that it harms comprehension, preserving settled geometry is cheaper and safer than inventing a second layout engine after ELK. A future spacing change needs its own issue, examples, objective priority, and canvas-growth budget.

This is consistent with established layout APIs: ELK's [`org.eclipse.elk.spacing.nodeNode`](https://eclipse.dev/elk/reference/options/org-eclipse-elk-spacing-nodeNode.html) is a primary-layout minimum-distance option, and Graphviz [`nodesep`](https://graphviz.org/docs/attrs/nodesep/) is separation between adjacent nodes in the same rank. Neither is a general guarantee that arbitrary later node shoves can be repaired independently without re-running placement.

## Research boundary

The graph-drawing literature supports a much smaller requirement than a universal arrowhead-surface contract:

- Wybrow, Marriott, and Stuckey, [*Orthogonal Connector Routing*](https://doi.org/10.1007/978-3-642-11805-0_22), searches an orthogonal visibility graph for valid obstacle-avoiding routes while minimizing length and bends, then nudges shared segments. Its visibility graph is quadratic in obstacle count and the route search is substantially more machinery than needed when the repository's existing lane prover can close the seven valid replacements after its final proof context is corrected.
- Marriott, Stuckey, and Wybrow, [*Seeing Around Corners: Fast Orthogonal Connector Routing*](https://doi.org/10.1007/978-3-662-44043-8_4), explicitly assumes rectangular obstacles for simplicity and notes that complex shapes can be approximated by convex polygons. It supports coherent obstacle geometry and bend minimization, not a universal 5° terminal-normal rule.
- Schulze, Spönemann, and von Hanxleden, [*Drawing layered graphs with port constraints*](https://doi.org/10.1016/j.jvlc.2013.11.005), and ELK's [`portConstraints`](https://eclipse.dev/elk/reference/options/org-eclipse-elk-portConstraints.html) support placing endpoint constraints inside layered layout. They do not require a post-layout fixed-length diagonal adapter for every rendered shape.
- Binucci et al., [*Placing Arrows in Directed Graph Layouts: Algorithms and Experiments*](https://doi.org/10.1111/cgf.14440), optimize arrow overlap and ambiguity and evaluate direction recognition. The paper does not establish 5° surface-normal incidence, a 12 px adapter, or one fixed marker size as perceptual laws.

Industry systems make the same separation:

- Graphviz clips heads and tails to node boundaries (`headclip` / `tailclip`) and exposes explicit ports (`headport` / `tailport`); it does not promise exact local-normal incidence for every shape.
- [libavoid](https://www.adaptagrams.org/documentation/libavoid.html) is a full object-avoiding orthogonal router. Its [`ShapeRef`](https://www.adaptagrams.org/documentation/classAvoid_1_1ShapeRef.html) accepts polygon obstacles and connection-pin directions. Adopting that class of router would be reasonable if local repair is replaced wholesale, but layering an equivalent solver over ELK for 19 late hitches is not the cheaper fix.

Thus the alternative uses the existing proof once more at the only point where its result matters: settled final geometry. Arrowhead wing collisions, marker-to-shaft aesthetics, exact surface normals, rounded/custom outlines, and general marker-aware routing remain separate concerns and should not be used to expand issue #88.

## Reproduction

```bash
bun test src/__tests__/issue-88-minimal-hitch-closure.test.ts src/__tests__/issue-88-closure-idempotence.test.ts
bun run eval/degenerate-etn/enum-hitches.ts
```

The focused test pins all 19 `main` failures. Separate bucket tests prove that a real late-closure case loses bends and is idempotent, while a context-only case retains its route because two settled label pills do not have the required combined 16 px halo clearance. The existing route-contract suite retains determinism and certificate coverage. The enumerator remains an explicit evidence command rather than adding 2,800 layouts to every CI run.
