import type { WardleyBuildResult, WardleyNode } from './builder.ts'

export function claimWardleyId(base: string, used: Set<string>): string {
  let id = base, suffix = 1
  while (used.has(id)) id = `${base}#${suffix++}`
  used.add(id)
  return id
}

/** Keep ordinary pipeline IDs while reserving authored global names and the
 * identities already assigned to other parent/name pairs. */
export function wardleyPipelineIds(authored: Iterable<string>): (parent: string, name: string) => string {
  const used = new Set(authored), scopes = new Map<string, Map<string, string>>()
  return (parent, name) => {
    let names = scopes.get(parent)
    if (!names) { names = new Map(); scopes.set(parent, names) }
    const known = names.get(name)
    if (known !== undefined) return known
    const id = claimWardleyId(`${parent}_${name}`, used)
    names.set(name, id)
    return id
  }
}

export function wardleyPipelineGroups(body: Pick<WardleyBuildResult, 'nodes' | 'pipelines'>): Map<string, string> {
  const groups = new Map<string, string>()
  if (!body.pipelines.length) return groups
  const used = new Set(body.nodes.map(node => node.id))
  for (const pipeline of body.pipelines) groups.set(pipeline.nodeId, claimWardleyId(`pipeline:${pipeline.nodeId}`, used))
  return groups
}

export function wardleyLabels(nodes: Iterable<WardleyNode>): Map<string, string> {
  const labels = new Map<string, string>()
  for (const node of nodes) if (!labels.has(node.label)) labels.set(node.label, node.id)
  return labels
}

export function wardleyReference(name: string, nodes: ReadonlyMap<string, WardleyNode>, labels: ReadonlyMap<string, string>): string {
  return nodes.has(name) ? name : labels.get(name) ?? name
}

/** Generated IDs describe the emitted source. Rebase their references when a
 * structural edit changes the authored namespace that reserves them. */
export function rebaseWardleyPipelines(body: WardleyBuildResult): void {
  if (!body.pipelines.length) return
  const children = new Set(body.pipelines.flatMap(pipeline => pipeline.componentIds))
  const standalone = body.nodes.filter(node => !children.has(node.id))
  const allocate = wardleyPipelineIds(standalone.map(node => node.id))
  const owners = new Map(body.pipelines.flatMap(pipeline => pipeline.componentIds.map(id => [id, pipeline.nodeId] as const)))
  const renamed = new Map<string, string>(), ordered = body.nodes.filter(node => children.has(node.id))
  for (const node of ordered) {
    const parent = owners.get(node.id)!
    renamed.set(node.id, allocate(renamed.get(parent) ?? parent, node.label))
  }
  const rename = (id: string) => renamed.get(id) ?? id
  for (const node of ordered) node.id = rename(node.id)
  for (const pipeline of body.pipelines) {
    pipeline.nodeId = rename(pipeline.nodeId)
    pipeline.componentIds = pipeline.componentIds.map(rename)
  }
  for (const link of body.links) { link.source = rename(link.source); link.target = rename(link.target) }
  for (const trend of body.trends) trend.nodeId = rename(trend.nodeId)
  body.nodes = [...standalone, ...ordered]
}
