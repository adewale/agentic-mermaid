import type { MermaidGraph } from '../types.ts'
import type { FlowchartMutationOp } from '../agent/types.ts'

export type AgentflowRole = 'task' | 'tool' | 'action' | 'input' | 'refdoc' | 'decision' | 'connector'
export interface AgentflowMapping {
  id: string
  type: 'vertex' | 'edge' | 'flow' | 'connector' | 'attachment'
  line: number
  col: number
  endLine: number
  endCol: number
}

/** Topology is the shared graph IR. AgentFlow's roles, arbitrary YAML,
 * connector declarations and global escape semantics remain family-owned. */
export interface AgentflowBody {
  kind: 'agentflow'
  graph: MermaidGraph
  metadata: Map<string, Record<string, unknown>>
  roles: Map<string, AgentflowRole>
  connectors: Set<string>
  globals: Set<string>
  mappings: AgentflowMapping[]
}
export type AgentflowMutationOp = FlowchartMutationOp
  | { kind: 'set_metadata'; target: string; metadata: Record<string, unknown> | null }
  | { kind: 'set_role'; id: string; role: AgentflowRole }
