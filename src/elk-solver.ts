import type { ElkNode } from 'elkjs'
import { elkLayoutSync } from './elk-layered/kernel/layout.ts'

export type ElkSolver = (graph: ElkNode) => ElkNode

/** Bundled synchronous provider; published Node entries use its deferred twin. */
export function elkSolver(): ElkSolver { return elkLayoutSync }
