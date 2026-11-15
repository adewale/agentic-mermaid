// Kept external to the installed ESM entries so Native-only use does not load
// the Layered solver. The bundled CJS provider is included in the package.
import { createRequire } from 'node:module'

let solver

export function elkSolver() {
  if (solver === undefined) solver = (typeof require === 'function'
    ? require('./elk-solver.cjs')
    : createRequire(import.meta.url)('./elk-solver.cjs')).elkSolver()
  return solver
}
