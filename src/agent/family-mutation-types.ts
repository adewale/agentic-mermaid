import type { AgentflowMutationOp, AnyMutationOp, CynefinMutationOp, DiagramKind, ParsedDiagram, RailroadMutationOp, SwimlaneMutationOp, TreeviewMutationOp, UsecaseMutationOp, VennMutationOp, WardleyMutationOp } from './types.ts'

interface NativeFamilyMutationOps {
  agentflow: AgentflowMutationOp
  cynefin: CynefinMutationOp
  railroad: RailroadMutationOp
  swimlane: SwimlaneMutationOp
  treeview: TreeviewMutationOp
  usecase: UsecaseMutationOp
  venn: VennMutationOp
  wardley: WardleyMutationOp
}
/** The general dispatcher still accepts union-typed inputs. A concrete native
 * family cannot escape its operation type through that general overload. */
export type MutationOpForFamily<K extends DiagramKind> = K extends keyof NativeFamilyMutationOps ? NativeFamilyMutationOps[K] : AnyMutationOp
export type MutationOpForDiagram<D extends ParsedDiagram> = D extends { body: { kind: infer K } } ? (K extends DiagramKind ? MutationOpForFamily<K> : AnyMutationOp) : AnyMutationOp
