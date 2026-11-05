// Authored built-in header rules shared by complete descriptors, compatibility
// parsing and lazy browser discovery. No family implementation is imported here.

/** Lightweight compatibility-parser ownership, deliberately independent of
 * the complete family registry so direct graph-parser imports remain usable. */
export function detectsFlowchartFamily(firstLine: string): boolean {
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^(?:flowchart|graph)(?:\s|$)/.test(line)
}

export function detectsStateFamily(firstLine: string): boolean {
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^statediagram(?:-v2)?\s*$/.test(line)
}

export function detectsStateFamilyLoose(firstLine: string): boolean {
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^statediagram(?:-v2)?(?:\s|$)/.test(line)
}

export const detectsSequenceFamily = (line: string) => /^sequencediagram\s*$/.test(line)
export const detectsSequenceFamilyLoose = (line: string) => /^sequencediagram(?:\s|$)/.test(line)
export const detectsTimelineFamily = (line: string) => /^timeline(?=$|[\s;#%])/.test(line)
export const detectsTimelineFamilyLoose = (line: string) => /^timeline(?=$|[\s;#%])/.test(line)
export const detectsClassFamily = (line: string) => /^classdiagram(?:-v2)?\s*$/.test(line)
export const detectsClassFamilyLoose = (line: string) => /^classdiagram(?:-v2)?(?:\s|$)/.test(line)
export const detectsErFamily = (line: string) => /^erdiagram(?:\s+subgraph\b.*)?\s*$/.test(line)
export const detectsErFamilyLoose = (line: string) => /^erdiagram(?:\s|$)/.test(line)
export const detectsJourneyFamily = (line: string) => /^journey\s*$/.test(line)
export const detectsJourneyFamilyLoose = (line: string) => /^journey(?:\s|$)/.test(line)
export const detectsArchitectureFamily = (line: string) => /^architecture(?:-beta)?\s*$/.test(line)
export const detectsArchitectureFamilyLoose = (line: string) => /^architecture(?:-beta)?(?:\s|$)/.test(line)
export const detectsXychartFamily = (line: string) => /^xychart(?:-beta)?(?:\s|$)/.test(line)
export const detectsPieFamily = (line: string) => /^pie(?:\s|$)/.test(line)
export const detectsQuadrantFamily = (line: string) => /^quadrant(?:chart)?\s*$/.test(line)
export const detectsQuadrantFamilyLoose = (line: string) => /^quadrant(?:chart)?(?:\s|$)/.test(line)
export const detectsGanttFamily = (line: string) => /^gantt\s*$/.test(line)
export const detectsGanttFamilyLoose = (line: string) => /^gantt(?:\s|$)/.test(line)
export const detectsMindmapFamily = (line: string) => /^mindmap\s*$/.test(line)
export const detectsMindmapFamilyLoose = (line: string) => /^mindmap(?:\s|$)/.test(line)
export const detectsGitgraphFamily = (line: string) => /^gitgraph(?:\s+(?:lr|tb|bt))?\s*:?\s*$/.test(line)
export const detectsGitgraphFamilyLoose = (line: string) => /^gitgraph(?:\s|:|$)/.test(line)
export const detectsRadarFamily = (line: string) => /^radar-beta(?:\s|:|$)/.test(line)
export const detectsSankeyFamily = (line: string) => /^sankey(?:-beta)?\s*$/.test(line)
export const detectsSankeyFamilyLoose = (line: string) => /^sankey(?:-beta)?(?:\s|$)/.test(line)
export const detectsC4Family = (line: string) => /^c4(?:context|container|component|dynamic|deployment)(?:\s|$)/.test(line)
export const detectsC4FamilyLoose = (line: string) => /^c4(?:context|container|component|dynamic|deployment)(?:\s|$)/.test(line)
export const detectsPacketFamily = (line: string) => /^packet(?:-beta)?\s*$/.test(line)
export const detectsKanbanFamily = (line: string) => /^kanban\s*$/.test(line)
export const detectsRequirementFamily = (line: string) => /^requirement(?:diagram)?\s*$/.test(line)
export const detectsTreemapFamily = (line: string) => /^treemap(?:-beta)?\s*$/.test(line)
export const detectsIshikawaFamily = (line: string) => /^ishikawa(?:-beta)?\s*$/.test(line)
export const detectsBlockFamily = (line: string) => /^block(?:-beta)?\s*$/.test(line)
export const detectsZenumlFamily = (line: string) => /^zenuml\s*$/.test(line)
export const detectsEventmodelingFamily = (line: string) => /^eventmodeling\s*$/.test(line)

export const detectsSwimlaneFamily = (line: string) => /^swimlane(?:-beta)?(?:\s|$)/.test(line)
export const detectsTreeviewFamily = (line: string) => /^treeview-beta(?:\s|$)/.test(line)

export const detectsAgentflowFamily = (line: string) => /^agentflow-beta(?:\s|$)/.test(line)

export const detectsUsecaseFamily = (line: string) => /^usecase-beta(?:\s|$)/.test(line)

export const detectsWardleyFamily = (line: string) => /^wardley-beta(?:\s|$)/.test(line)

export const detectsVennFamily = (line: string) => /^venn-beta(?:\s|$)/.test(line)

export const detectsCynefinFamily = (line: string) => /^cynefin-beta(?:\s|:|$)/.test(line)

export const detectsRailroadFamily = (line: string) => /^railroad-(?:(?:ebnf|abnf|peg)-)?beta(?:\s|$)/.test(line)
