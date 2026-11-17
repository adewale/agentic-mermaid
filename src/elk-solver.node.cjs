// Shipped verbatim as CommonJS so require is lexical to this provider, including
// when an installed ESM entry is loaded by a CommonJS caller. A consumer's
// bundler still sees the literal edge and includes the deferred solver.
let solver

exports.elkSolver = function elkSolver() {
  if (solver === undefined) solver = require('./elk-solver.cjs').elkSolver()
  return solver
}
