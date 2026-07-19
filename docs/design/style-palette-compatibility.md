# Style + Palette compatibility receipt

Compatibility is owned by the registry-derived portfolio in
`src/__tests__/render-conformance-plan.test.ts`, not by a copied family roster
or the former 4,500-row docs-example Cartesian product.

The executable plan provides three complementary proofs:

1. **Pure bounded exhaustion:** every registered non-default Look × Palette
   stack is resolved as data. All palette channels and precedence rules are
   checked without paying for a family render.
2. **Variable-strength real rendering:** the core SVG plan covers every valid
   pair across family, Look, Palette, security, background polarity and
   complexity stratum. It exhausts Look × Palette × background polarity and
   raises strength for family × backend × complexity, palette-sensitive Scene
   role signatures, external-reference syntax and contact-sheet witnesses.
3. **Mixed output projection:** a separate plan crosses every family with
   backend, complexity and SVG/PNG/ASCII/Unicode, including every-family
   text/Unicode stress through every output.

Every registered family contributes six mandatory sources:

- minimal registry example;
- representative generated source;
- structurally dense generated source;
- multilingual/combining/emoji text stress;
- family-risk syntax;
- highest-complexity structured source discovered in the eval corpus.

Adding a `DiagramKind` cannot compile until its conformance profile exists.
Runtime exact-set checks, independent tuple enumeration and fake/removed-family
sabotage prevent a hidden opt-out.

The current measured candidate contains 1,047 core rows covering 2,739 declared
obligations and 135 mixed-format rows covering 309 obligations. These counts
are derived and pinned by [`eval/test-portfolio/candidate.json`](../../eval/test-portfolio/candidate.json);
they are not API constants.

The former family × Look × Palette matrix proved every named triple for one
simple SVG source. The replacement intentionally does **not** retain that exact
triple claim. Instead it proves every family/Look, family/Palette and
Look/Palette pair; exhausts the pure stack and Look/Palette/background
contracts; exercises six complexity strata; and retains focused fault probes.
A faster plan with weaker fault sensitivity would not have been accepted.

The styled-output suite separately hash-pins every registered non-default Look
over the layout fixture corpus, verifies deterministic seed behavior, exercises
default/rough/hybrid backends, and tests user-color precedence. Exact bytes
remain focused rather than becoming the interaction planner's oracle.

Run:

```bash
bun test src/__tests__/render-conformance-plan.test.ts
bun test src/__tests__/styled-output.test.ts --timeout 30000
bun test src/__tests__/test-portfolio-fault-sensitivity.test.ts
```

Human sense-making is separate from machine conformance:

- [`../project/complexity-aware-test-portfolio-plan.md`](../project/complexity-aware-test-portfolio-plan.md) defines the Cynefin rationale and review protocol;
- `bun run contact:sheet:test-portfolio --kind citizenship --output-dir <dir>` generates a hash-bound 60-cell probe;
- [`../../eval/test-portfolio/contact-sheets/citizenship.html`](../../eval/test-portfolio/contact-sheets/citizenship.html) is the current committed probe;
- its review record remains explicitly pending until an independent human inspects it.

This is a compatibility and interaction receipt, not a universal aesthetic
claim. Contact sheets, native-size human review, production smoke and external
consumer evidence remain independent oracles.
