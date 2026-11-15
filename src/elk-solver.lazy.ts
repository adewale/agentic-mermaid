import { DeferredDependencyError } from './layout/certification-error.ts'
import type { ElkSolver } from './elk-solver.ts'

let solver: ElkSolver | undefined
async function load(): Promise<void> { solver = (await import('./elk-layered/kernel/layout.ts')).elkLayoutSync }

/** Build-only provider for the browser's existing deferred ELK boundary. */
export function elkSolver(): ElkSolver {
  if (solver === undefined) throw new DeferredDependencyError('ELK', load)
  return solver
}
