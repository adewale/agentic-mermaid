import { RAILROAD_SVG_HOOKS } from './svg-family-hooks/railroad.ts'
import { CYNEFIN_SVG_HOOKS } from './svg-family-hooks/cynefin.ts'
import { VENN_SVG_HOOKS } from './svg-family-hooks/venn.ts'
import { WARDLEY_SVG_HOOKS } from './svg-family-hooks/wardley.ts'
import { USECASE_SVG_HOOKS } from './svg-family-hooks/usecase.ts'
import { AGENTFLOW_SVG_HOOKS } from './svg-family-hooks/agentflow.ts'
import { SWIMLANE_SVG_HOOKS } from './svg-family-hooks/swimlane.ts'
import { TREEVIEW_SVG_HOOKS } from './svg-family-hooks/treeview.ts'
import { ZENUML_SVG_HOOKS } from './svg-family-hooks/zenuml.ts'
import { EVENTMODELING_SVG_HOOKS } from './svg-family-hooks/eventmodeling.ts'
import { PACKET_SVG_HOOKS } from './svg-family-hooks/packet.ts'
import { KANBAN_SVG_HOOKS } from './svg-family-hooks/kanban.ts'
import { REQUIREMENT_SVG_HOOKS } from './svg-family-hooks/requirement.ts'
import { TREEMAP_SVG_HOOKS } from './svg-family-hooks/treemap.ts'
import { ISHIKAWA_SVG_HOOKS } from './svg-family-hooks/ishikawa.ts'
import { BLOCK_SVG_HOOKS } from './svg-family-hooks/block.ts'
import { C4_SVG_HOOKS } from './svg-family-hooks/c4.ts'
import { ARCHITECTURE_SVG_HOOKS } from './svg-family-hooks/architecture.ts'
import { CLASS_SVG_HOOKS } from './svg-family-hooks/class.ts'
import { ER_SVG_HOOKS } from './svg-family-hooks/er.ts'
import { FLOWCHART_SVG_HOOKS } from './svg-family-hooks/flowchart.ts'
import { GANTT_SVG_HOOKS } from './svg-family-hooks/gantt.ts'
import { GITGRAPH_SVG_HOOKS } from './svg-family-hooks/gitgraph.ts'
import { JOURNEY_SVG_HOOKS } from './svg-family-hooks/journey.ts'
import { MINDMAP_SVG_HOOKS } from './svg-family-hooks/mindmap.ts'
import { PIE_SVG_HOOKS } from './svg-family-hooks/pie.ts'
import { QUADRANT_SVG_HOOKS } from './svg-family-hooks/quadrant.ts'
import { RADAR_SVG_HOOKS } from './svg-family-hooks/radar.ts'
import { SANKEY_SVG_HOOKS } from './svg-family-hooks/sankey.ts'
import { SEQUENCE_SVG_HOOKS } from './svg-family-hooks/sequence.ts'
import { STATE_SVG_HOOKS } from './svg-family-hooks/state.ts'
import { TIMELINE_SVG_HOOKS } from './svg-family-hooks/timeline.ts'
import { XYCHART_SVG_HOOKS } from './svg-family-hooks/xychart.ts'
import {
  ZENUML_TERMINAL_HOOKS,
  EVENTMODELING_TERMINAL_HOOKS,
  FLOWCHART_TERMINAL_HOOKS,
  STATE_TERMINAL_HOOKS,
  ARCHITECTURE_TERMINAL_HOOKS,
  SEQUENCE_TERMINAL_HOOKS,
  CLASS_TERMINAL_HOOKS,
  ER_TERMINAL_HOOKS,
  TIMELINE_TERMINAL_HOOKS,
  JOURNEY_TERMINAL_HOOKS,
  XYCHART_TERMINAL_HOOKS,
  PIE_TERMINAL_HOOKS,
  QUADRANT_TERMINAL_HOOKS,
  RADAR_TERMINAL_HOOKS,
  SANKEY_TERMINAL_HOOKS,
  GANTT_TERMINAL_HOOKS,
  MINDMAP_TERMINAL_HOOKS,
  GITGRAPH_TERMINAL_HOOKS,
  C4_TERMINAL_HOOKS,
  PACKET_TERMINAL_HOOKS,
  KANBAN_TERMINAL_HOOKS,
  REQUIREMENT_TERMINAL_HOOKS,
  TREEMAP_TERMINAL_HOOKS,
  ISHIKAWA_TERMINAL_HOOKS,
  BLOCK_TERMINAL_HOOKS,
  CYNEFIN_TERMINAL_HOOKS,
  VENN_TERMINAL_HOOKS,
  WARDLEY_TERMINAL_HOOKS,
  USECASE_TERMINAL_HOOKS,
  AGENTFLOW_TERMINAL_HOOKS,
  SWIMLANE_TERMINAL_HOOKS,
  TREEVIEW_TERMINAL_HOOKS,
  RAILROAD_TERMINAL_HOOKS,
} from './terminal-family-hooks.ts'
import type { FamilyDescriptor } from './agent/family-registry.ts'
import type { DiagramKind } from './agent/types.ts'

type BuiltinRenderHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'layout' | 'projectPositioned' | 'renderAscii' | 'lowerScene'>

export const ZENUML_RENDER_HOOKS = { ...ZENUML_SVG_HOOKS, ...ZENUML_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const EVENTMODELING_RENDER_HOOKS = { ...EVENTMODELING_SVG_HOOKS, ...EVENTMODELING_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const FLOWCHART_RENDER_HOOKS = { ...FLOWCHART_SVG_HOOKS, ...FLOWCHART_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const STATE_RENDER_HOOKS = { ...STATE_SVG_HOOKS, ...STATE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const ARCHITECTURE_RENDER_HOOKS = { ...ARCHITECTURE_SVG_HOOKS, ...ARCHITECTURE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const SEQUENCE_RENDER_HOOKS = { ...SEQUENCE_SVG_HOOKS, ...SEQUENCE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const CLASS_RENDER_HOOKS = { ...CLASS_SVG_HOOKS, ...CLASS_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const ER_RENDER_HOOKS = { ...ER_SVG_HOOKS, ...ER_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const TIMELINE_RENDER_HOOKS = { ...TIMELINE_SVG_HOOKS, ...TIMELINE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const JOURNEY_RENDER_HOOKS = { ...JOURNEY_SVG_HOOKS, ...JOURNEY_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const XYCHART_RENDER_HOOKS = { ...XYCHART_SVG_HOOKS, ...XYCHART_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const PIE_RENDER_HOOKS = { ...PIE_SVG_HOOKS, ...PIE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const QUADRANT_RENDER_HOOKS = { ...QUADRANT_SVG_HOOKS, ...QUADRANT_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const RADAR_RENDER_HOOKS = { ...RADAR_SVG_HOOKS, ...RADAR_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const SANKEY_RENDER_HOOKS = { ...SANKEY_SVG_HOOKS, ...SANKEY_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const GANTT_RENDER_HOOKS = { ...GANTT_SVG_HOOKS, ...GANTT_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const MINDMAP_RENDER_HOOKS = { ...MINDMAP_SVG_HOOKS, ...MINDMAP_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const GITGRAPH_RENDER_HOOKS = { ...GITGRAPH_SVG_HOOKS, ...GITGRAPH_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const C4_RENDER_HOOKS = { ...C4_SVG_HOOKS, ...C4_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const PACKET_RENDER_HOOKS = { ...PACKET_SVG_HOOKS, ...PACKET_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const KANBAN_RENDER_HOOKS = { ...KANBAN_SVG_HOOKS, ...KANBAN_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const REQUIREMENT_RENDER_HOOKS = { ...REQUIREMENT_SVG_HOOKS, ...REQUIREMENT_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const TREEMAP_RENDER_HOOKS = { ...TREEMAP_SVG_HOOKS, ...TREEMAP_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const ISHIKAWA_RENDER_HOOKS = { ...ISHIKAWA_SVG_HOOKS, ...ISHIKAWA_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const BLOCK_RENDER_HOOKS = { ...BLOCK_SVG_HOOKS, ...BLOCK_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const CYNEFIN_RENDER_HOOKS = { ...CYNEFIN_SVG_HOOKS, ...CYNEFIN_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const VENN_RENDER_HOOKS = { ...VENN_SVG_HOOKS, ...VENN_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const WARDLEY_RENDER_HOOKS = { ...WARDLEY_SVG_HOOKS, ...WARDLEY_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const USECASE_RENDER_HOOKS = { ...USECASE_SVG_HOOKS, ...USECASE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const AGENTFLOW_RENDER_HOOKS = { ...AGENTFLOW_SVG_HOOKS, ...AGENTFLOW_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const SWIMLANE_RENDER_HOOKS = { ...SWIMLANE_SVG_HOOKS, ...SWIMLANE_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const TREEVIEW_RENDER_HOOKS = { ...TREEVIEW_SVG_HOOKS, ...TREEVIEW_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const RAILROAD_RENDER_HOOKS = { ...RAILROAD_SVG_HOOKS, ...RAILROAD_TERMINAL_HOOKS } satisfies BuiltinRenderHooks

export const BUILTIN_RENDER_HOOKS = /* @__PURE__ */ Object.freeze({
  flowchart: FLOWCHART_RENDER_HOOKS,
  railroad: RAILROAD_RENDER_HOOKS,
  cynefin: CYNEFIN_RENDER_HOOKS,
  venn: VENN_RENDER_HOOKS,
  wardley: WARDLEY_RENDER_HOOKS,
  usecase: USECASE_RENDER_HOOKS,
  agentflow: AGENTFLOW_RENDER_HOOKS,
  swimlane: SWIMLANE_RENDER_HOOKS,
  treeview: TREEVIEW_RENDER_HOOKS,
  state: STATE_RENDER_HOOKS,
  sequence: SEQUENCE_RENDER_HOOKS,
  timeline: TIMELINE_RENDER_HOOKS,
  class: CLASS_RENDER_HOOKS,
  er: ER_RENDER_HOOKS,
  journey: JOURNEY_RENDER_HOOKS,
  xychart: XYCHART_RENDER_HOOKS,
  architecture: ARCHITECTURE_RENDER_HOOKS,
  pie: PIE_RENDER_HOOKS,
  quadrant: QUADRANT_RENDER_HOOKS,
  radar: RADAR_RENDER_HOOKS,
  sankey: SANKEY_RENDER_HOOKS,
  c4: C4_RENDER_HOOKS,
  packet: PACKET_RENDER_HOOKS,
  kanban: KANBAN_RENDER_HOOKS,
  requirement: REQUIREMENT_RENDER_HOOKS,
  treemap: TREEMAP_RENDER_HOOKS,
  ishikawa: ISHIKAWA_RENDER_HOOKS,
  block: BLOCK_RENDER_HOOKS,

  gantt: GANTT_RENDER_HOOKS,
  mindmap: MINDMAP_RENDER_HOOKS,
  gitgraph: GITGRAPH_RENDER_HOOKS,
  zenuml: ZENUML_RENDER_HOOKS,
  eventmodeling: EVENTMODELING_RENDER_HOOKS,
}) satisfies Readonly<Record<DiagramKind, BuiltinRenderHooks>>
