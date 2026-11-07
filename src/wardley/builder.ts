import { observeParserMutation, type ParserObservationSource } from '../shared/parser-observation.ts'
// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { GrammarReadError } from '../shared/grammar-reader-error.ts'
import { wardleyLabels, wardleyReference } from './identity.ts'

export type SourceStrategy = 'build' | 'buy' | 'outsource' | 'market'
export type Flow = 'forward' | 'backward' | 'bidirectional'

// Coordinates are percentages: x is evolution, y is visibility.
export interface WardleyNode {
  id: string
  label: string
  x?: number
  y?: number
  // 'anchor', 'component', or 'pipeline-component'
  className?: string
  labelOffsetX?: number
  labelOffsetY?: number
  inPipeline?: boolean
  isPipelineParent?: boolean
  inertia?: boolean
  sourceStrategy?: SourceStrategy
}

export interface WardleyLink {
  source: string
  target: string
  dashed?: boolean
  label?: string
  flow?: Flow
}

export interface WardleyTrend {
  nodeId: string
  targetX: number
  targetY: number
}

export interface WardleyPipeline {
  nodeId: string
  componentIds: string[]
}

export interface WardleyAnnotation {
  number: number
  coordinates: { x: number; y: number }[]
  text?: string
}

export interface WardleyNote {
  text: string
  x: number
  y: number
}

export interface WardleyForce {
  name: string
  x: number
  y: number
}

export interface WardleyAxesConfig {
  xLabel?: string
  yLabel?: string
  stages?: string[]
  // Right edge of each stage, from 0 to 1.
  stageBoundaries?: number[]
}

export interface WardleyBuildResult {
  nodes: WardleyNode[]
  links: WardleyLink[]
  trends: WardleyTrend[]
  pipelines: WardleyPipeline[]
  annotations: WardleyAnnotation[]
  notes: WardleyNote[]
  accelerators: WardleyForce[]
  deaccelerators: WardleyForce[]
  annotationsBox?: { x: number; y: number }
  axes: WardleyAxesConfig
  size?: { width: number; height: number }
}

export class WardleyBuilder {
  private observationSource?: ParserObservationSource
  /** The model builder supplies the AST object that owns this actual write. */
  atSource(source: ParserObservationSource | undefined): this { this.observationSource = source; return this }

  private nodes = new Map<string, WardleyNode>()
  private labels: Map<string, string> | undefined
  private links: WardleyLink[] = []
  private trends = new Map<string, WardleyTrend>()
  private pipelines = new Map<string, WardleyPipeline>()
  private annotations: WardleyAnnotation[] = []
  private notes: WardleyNote[] = []
  private accelerators: WardleyForce[] = []
  private deaccelerators: WardleyForce[] = []
  private annotationsBox?: { x: number; y: number }
  private axes: WardleyAxesConfig = {}
  private size?: { width: number; height: number }

  // A node added again keeps its class and label offsets unless the new one sets them.
  addNode(node: WardleyNode): void {
    const existing = this.nodes.get(node.id) ?? { id: node.id, label: node.label }
    this.nodes.set(node.id, {
      ...existing,
      ...node,
      className: node.className ?? existing.className,
      labelOffsetX: node.labelOffsetX ?? existing.labelOffsetX,
      labelOffsetY: node.labelOffsetY ?? existing.labelOffsetY,
    })
    this.labels = undefined
    observeParserMutation('wardley', 'add-node', this.nodes.get(node.id), this.observationSource)
  }

  addLink(link: WardleyLink): void {
    this.links.push(link)
    observeParserMutation('wardley', 'add-link', link, this.observationSource)
  }

  addTrend(trend: WardleyTrend): void {
    this.trends.set(trend.nodeId, trend)
    observeParserMutation('wardley', 'add-trend', trend, this.observationSource)
  }

  startPipeline(nodeId: string): void {
    if (!this.pipelines.has(nodeId)) this.pipelines.set(nodeId, { nodeId, componentIds: [] })
    const node = this.nodes.get(nodeId)
    if (node) node.isPipelineParent = true
    observeParserMutation('wardley', 'start-pipeline', this.pipelines.get(nodeId), this.observationSource)
  }

  addPipelineComponent(pipelineNodeId: string, componentId: string): void {
    const node = this.nodes.get(componentId)
    if (!node?.inPipeline) this.pipelines.get(pipelineNodeId)?.componentIds.push(componentId)
    if (node) node.inPipeline = true
    observeParserMutation('wardley', 'add-pipeline-component', this.pipelines.get(pipelineNodeId), this.observationSource)
  }

  addAnnotation(annotation: WardleyAnnotation): void {
    this.annotations.push(annotation)
    observeParserMutation('wardley', 'add-annotation', annotation, this.observationSource)
  }

  addNote(note: WardleyNote): void {
    this.notes.push(note)
    observeParserMutation('wardley', 'add-note', note, this.observationSource)
  }

  addAccelerator(accelerator: WardleyForce): void {
    this.accelerators.push(accelerator)
    observeParserMutation('wardley', 'add-accelerator', accelerator, this.observationSource)
  }

  addDeaccelerator(deaccelerator: WardleyForce): void {
    this.deaccelerators.push(deaccelerator)
    observeParserMutation('wardley', 'add-deaccelerator', deaccelerator, this.observationSource)
  }

  setAnnotationsBox(x: number, y: number): void {
    this.annotationsBox = { x, y }
    observeParserMutation('wardley', 'set-annotations-box', this.annotationsBox, this.observationSource)
  }

  setAxes(partial: WardleyAxesConfig): void {
    this.axes = { ...this.axes, ...partial }
    observeParserMutation('wardley', 'set-axes', this.axes, this.observationSource)
  }

  setSize(width: number, height: number): void {
    this.size = { width, height }
    observeParserMutation('wardley', 'set-size', this.size, this.observationSource)
  }

  getNode(id: string): WardleyNode | undefined {
    return this.nodes.get(id)
  }

  // A name is a node id, or else the label of the first node that has it. Pipeline components
  // have ids like "Parent_Child" and are linked by label.
  resolveNodeId(name: string): string {
    if (this.nodes.has(name)) return name
    this.labels ??= wardleyLabels(this.nodes.values())
    return wardleyReference(name, this.nodes, this.labels)
  }

  build(): WardleyBuildResult {
    const nodes: WardleyNode[] = []
    for (const node of this.nodes.values()) {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') {
        throw new GrammarReadError(`Node "${node.label}" is missing coordinates`, 'semantic', { type: 'wardley' })
      }
      nodes.push(node)
    }
    return {
      nodes,
      links: [...this.links],
      trends: [...this.trends.values()],
      pipelines: [...this.pipelines.values()],
      annotations: [...this.annotations],
      notes: [...this.notes],
      accelerators: [...this.accelerators],
      deaccelerators: [...this.deaccelerators],
      annotationsBox: this.annotationsBox,
      axes: { ...this.axes },
      size: this.size,
    }
  }
}
