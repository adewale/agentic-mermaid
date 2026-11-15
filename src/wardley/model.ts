// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { GrammarReadError } from '../shared/grammar-reader-error.ts'
import { WardleyBuilder, type Flow, type SourceStrategy, type WardleyBuildResult } from './builder.ts'
import { wardleyAstSource, type LabelAst, type WardleyAst } from './parser.ts'
import { wardleyPipelineIds } from './identity.ts'

export interface WardleyModel extends WardleyBuildResult {
  type: 'wardley'
  title: string | undefined
  accTitle: string | undefined
  accDescr: string | undefined
}

// Values up to 1 are fractions; larger ones are already percentages.
function toPercent(value: number, context: string): number {
  const normalized = value <= 1 ? value * 100 : value
  if (normalized < 0 || normalized > 100) {
    throw new GrammarReadError(`${context} must be between 0-1 (decimal) or 0-100 (percentage). Received: ${value}`, 'semantic', {
      type: 'wardley',
    })
  }
  return normalized
}

function toCoordinates(visibility: number, evolution: number, context: string): { x: number; y: number } {
  return { x: toPercent(evolution, `${context} evolution`), y: toPercent(visibility, `${context} visibility`) }
}

function flowFromPort(port: string | undefined): Flow | undefined {
  return port === '+<>' ? 'bidirectional' : port === '+<' ? 'backward' : port === '+>' ? 'forward' : undefined
}

function flowFromArrow(arrow: string | undefined): { flow?: Flow; label?: string } {
  if (!arrow?.startsWith('+')) return {}
  const end = arrow.indexOf("'", 2)
  const label = arrow[1] === "'" && end !== -1 ? arrow.slice(2, end) : undefined
  if (arrow.includes('<>')) return { flow: 'bidirectional', label }
  if (arrow.includes('<')) return { flow: 'backward', label }
  if (arrow.includes('>')) return { flow: 'forward', label }
  return { label }
}

function offsets(label: LabelAst | undefined): [number | undefined, number | undefined] {
  return label ? [(label.negX ? -1 : 1) * label.offsetX, (label.negY ? -1 : 1) * label.offsetY] : [undefined, undefined]
}

// Mermaid's populateDb: fills the builder from the syntax tree, in Mermaid's order.
export function populate(ast: WardleyAst, db: WardleyBuilder): void {
  if (ast.size) db.atSource(wardleyAstSource(ast.size)).setSize(ast.size.width, ast.size.height)

  if (ast.evolution) {
    db.atSource(wardleyAstSource(ast.evolution)).setAxes({
      stages: ast.evolution.stages.map(stage => (stage.secondName ? `${stage.name.trim()} / ${stage.secondName.trim()}` : stage.name.trim())),
      stageBoundaries: ast.evolution.stages.filter(stage => stage.boundary !== undefined).map(stage => stage.boundary!),
    })
  }

  for (const anchor of ast.anchors) {
    const at = toCoordinates(anchor.visibility, anchor.evolution, `Anchor "${anchor.name}"`)
    db.atSource(wardleyAstSource(anchor)).addNode({ id: anchor.name, label: anchor.name, x: at.x, y: at.y, className: 'anchor' })
  }

  for (const component of ast.components) {
    const at = toCoordinates(component.visibility, component.evolution, `Component "${component.name}"`)
    const [labelOffsetX, labelOffsetY] = offsets(component.label)
    db.atSource(wardleyAstSource(component)).addNode({
      id: component.name,
      label: component.name,
      x: at.x,
      y: at.y,
      className: 'component',
      labelOffsetX,
      labelOffsetY,
      inertia: component.inertia,
      sourceStrategy: component.decorator?.strategy as SourceStrategy | undefined,
    })
  }

  for (const note of ast.notes) {
    const at = toCoordinates(note.visibility, note.evolution, `Note "${note.text}"`)
    db.atSource(wardleyAstSource(note)).addNote({ text: note.text, x: at.x, y: at.y })
  }

  const pipelineId = ast.pipelines.length ? wardleyPipelineIds([...ast.anchors, ...ast.components].map(node => node.name)) : undefined
  for (const pipeline of ast.pipelines) {
    const parent = db.getNode(pipeline.parent)
    if (!parent || typeof parent.y !== 'number') {
      throw new GrammarReadError(`Pipeline "${pipeline.parent}" must reference an existing component with coordinates.`, 'semantic', {
        type: 'wardley',
      })
    }
    const y = parent.y
    db.atSource(wardleyAstSource(pipeline)).startPipeline(pipeline.parent)
    for (const component of pipeline.components) {
      const id = pipelineId!(pipeline.parent, component.name)
      const [labelOffsetX, labelOffsetY] = offsets(component.label)
      const x = toPercent(component.evolution, `Pipeline component "${component.name}" evolution`)
      db.atSource(wardleyAstSource(component)).addNode({
        id,
        label: component.name,
        x,
        y,
        className: 'pipeline-component',
        labelOffsetX,
        labelOffsetY,
        inertia: undefined,
        sourceStrategy: undefined,
      })
      db.atSource(wardleyAstSource(component)).addPipelineComponent(pipeline.parent, id)
    }
  }

  for (const link of ast.links) {
    const dashed = !!link.arrow && (link.arrow.includes('-.->') || link.arrow.includes('.-.'))
    const fromArrow = flowFromArrow(link.arrow)
    const flow = flowFromPort(link.fromPort) ?? flowFromPort(link.toPort) ?? fromArrow.flow
    db.atSource(wardleyAstSource(link)).addLink({
      source: db.resolveNodeId(link.from),
      target: db.resolveNodeId(link.to),
      dashed,
      label: fromArrow.label ?? link.linkLabel,
      flow,
    })
  }

  for (const evolve of ast.evolves) {
    const node = db.getNode(evolve.component)
    if (node?.y !== undefined) {
      db.atSource(wardleyAstSource(evolve)).addTrend({ nodeId: evolve.component, targetX: toPercent(evolve.target, `Evolve target for "${evolve.component}"`), targetY: node.y })
    }
  }

  if (ast.annotations.length > 0) {
    const at = toCoordinates(ast.annotations[0]!.x, ast.annotations[0]!.y, 'Annotations box')
    db.atSource(wardleyAstSource(ast.annotations[0]!)).setAnnotationsBox(at.x, at.y)
  }

  for (const annotation of ast.annotation) {
    const at = toCoordinates(annotation.x, annotation.y, `Annotation ${annotation.number}`)
    db.atSource(wardleyAstSource(annotation)).addAnnotation({ number: annotation.number, coordinates: [{ x: at.x, y: at.y }], text: annotation.text })
  }

  for (const accelerator of ast.accelerators) {
    const at = toCoordinates(accelerator.x, accelerator.y, `Accelerator "${accelerator.name}"`)
    db.atSource(wardleyAstSource(accelerator)).addAccelerator({ name: accelerator.name, x: at.x, y: at.y })
  }

  for (const deaccelerator of ast.deaccelerators) {
    const at = toCoordinates(deaccelerator.x, deaccelerator.y, `Deaccelerator "${deaccelerator.name}"`)
    db.atSource(wardleyAstSource(deaccelerator)).addDeaccelerator({ name: deaccelerator.name, x: at.x, y: at.y })
  }
}

export function buildWardley(ast: WardleyAst, title: string | undefined): WardleyModel {
  const db = new WardleyBuilder()
  populate(ast, db)
  return {
    type: 'wardley',
    title: ast.title || title,
    accTitle: ast.accTitle ? ast.accTitle.replace(/^\s+/g, '') : undefined,
    accDescr: ast.accDescr ? ast.accDescr.replace(/\n\s+/g, '\n') : undefined,
    ...db.build(),
  }
}
