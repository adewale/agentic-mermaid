// Trivial Compiler Equivalence (Move 7): Papadakis et al. (ICSE 2015) detect
// equivalent mutants automatically by COMPILING the original and the mutant and
// comparing the compiled output — if a compiler normalizes the two to identical
// code, the mutant is provably equivalent and can be excluded from the score
// without human judgement (we'd been hand-classifying survivors).
//
// SCOPE / honesty: Bun's transpiler does type-erasure + comment stripping +
// formatting normalization, but NOT dead-code elimination or constant folding,
// so this seed catches the equivalence classes those passes produce
// (type-annotation-only, comment-only, formatting-only differences). Full TCE —
// which also collapses `if (true) {…}`-style mutants — needs an optimizing
// minifier (esbuild/closure) and is the documented next step. The mechanism and
// API are here; widening the normalizer widens what it can prove.

const transpiler = new Bun.Transpiler({ loader: 'ts' })

/** Canonical form: types + comments stripped, whitespace collapsed. */
export function normalizeTs(source: string): string {
  return transpiler.transformSync(source).replace(/\s+/g, ' ').trim()
}

/** True iff two snippets are equivalent after transpilation (provably so). */
export function equivalentByTranspile(a: string, b: string): boolean {
  return normalizeTs(a) === normalizeTs(b)
}
