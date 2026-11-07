// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.

import { observeParserMutation, parserObservationActive } from '../../shared/parser-observation.ts'

import { lineColumn, locationText } from './lexer.ts'
import { PeleError } from './support.ts'
import { type Actor, type ActorType, type Animation, type BoundaryType, type Direction, emptyModel, type GraphStatement, type LabelType, type MetadataOccurrence, type Relationship, type RelationshipType, type Span, type SymbolKind, type UseCase, type UseCaseShape, type UsecaseModel } from './types.ts'

export interface DraftLabel {
  text: string
  type: LabelType
  span: Span
}

// keySpan is also where an error about the property points.
export interface DraftProperty extends MetadataOccurrence {
  value: string | boolean
}

// What every mention of an id carries: where it is, and whether the id was made from a label.
interface Named {
  id: string
  label: DraftLabel
  span: Span
  generated: boolean
}

export interface DraftElement extends Named {
  kind: 'actor' | 'usecase'
  parent?: DraftBoundary
  shape?: UseCaseShape
  metadata?: DraftProperty[]
  stereotype?: string
  classes: string[]
}

export interface DraftBoundary extends Named {
  classes: string[]
}

export interface DraftJson {
  id: string
  value: Record<string, unknown>
  propertyOrder: Map<string, string[]>
  span: Span
  classes: string[]
}

export interface DraftEndpoint extends Named {
  // Whether this mention declares the element, and whether it carries a `:::` suffix.
  declares: boolean
  classed: boolean
}

export interface DraftRelationship {
  source: DraftEndpoint
  target: DraftEndpoint
  span: Span
  id?: string
  idSpan?: Span
  type: RelationshipType
  arrowType: number
  label?: DraftLabel
  minlen: number
}

// Everything the parser read, in source order, before any of it is resolved.
export interface Drafts {
  elements: DraftElement[]
  boundaries: DraftBoundary[]
  jsons: DraftJson[]
  relationships: DraftRelationship[]
  notes: { target: string; span: Span; label: DraftLabel }[]
  metadata: { target: string; span: Span; properties: DraftProperty[]; statement: GraphStatement }[]
  classes: { targets: { id: string; span: Span }[]; classes: string[] }[]
  styles: { target: string; span: Span; styles: string[] }[]
  classDefs: { ids: string[]; styles: string[] }[]
  direction: Direction | undefined
  accTitle: string
  accDescription: string
}

export function emptyDrafts(): Drafts {
  return {
    elements: [],
    boundaries: [],
    jsons: [],
    relationships: [],
    notes: [],
    metadata: [],
    classes: [],
    styles: [],
    classDefs: [],
    direction: undefined,
    accTitle: '',
    accDescription: '',
  }
}

interface Origin {
  kind: SymbolKind
  span: Span
  generated: boolean
  // The label a generated id was derived from.
  label?: string
}

interface ElementState extends Named {
  kind: 'actor' | 'usecase'
  parent?: DraftBoundary
  shape?: UseCaseShape
  stereotype?: string
  stereotypeSpan?: Span
  classes: string[]
  actorType?: Exclude<ActorType, 'icon'>
  icon?: string
  business?: boolean
}

interface BoundaryState extends DraftBoundary {
  type?: BoundaryType
  members: string[]
}

function pushUnique(target: string[], values: readonly string[]): void {
  if (values.length === 0) return
  const seen = new Set(target)
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    target.push(value)
  }
}

// Which kind of element the keys of a metadata block could only belong to, for the error message.
function inferKind(properties: DraftProperty[]): string | undefined {
  const possible = new Set(['actor', 'usecase', 'boundary', 'edge'])
  for (const { key, value } of properties) {
    if (key === 'icon') {
      possible.clear()
      possible.add('actor')
    } else if (key === 'animate' || key === 'animation') {
      possible.clear()
      possible.add('edge')
    } else if (key === 'type') {
      possible.clear()
      if (value === 'rect' || value === 'package') possible.add('boundary')
      else if (value === 'normal' || value === 'hollow' || value === 'awesome') possible.add('actor')
    } else if (key === 'business') {
      possible.delete('boundary')
      possible.delete('edge')
    } else return undefined
  }
  return possible.size === 1 ? [...possible][0]! : undefined
}

// Resolves what the parser read into a model, once the whole diagram is read: which ids are
// actors, use cases, boundaries, JSON nodes or edges, in what order they appear, and whether the
// statements about them agree. Ports Mermaid's UsecaseModelBuilder, with its messages.
export function resolveUsecase(src: string, drafts: Drafts, headerSpan: Span, statements: GraphStatement[], title: string | undefined): UsecaseModel {
  const model = emptyModel()
  const { actors, useCases, systemBoundaries } = model
  const symbols = new Map<string, Origin>()
  const elements = new Map<string, ElementState>()
  const boundaries = new Map<string, BoundaryState>()
  const edges = new Map<string, Relationship>()
  // The offset at which each id is first mentioned, which decides the order of the model.
  const first = new Map<string, number>()

  const at = (span: Span): string => locationText(src, span[0]!, span[1]!)

  const error = (message: string, span: Span): PeleError => {
    const [line, column] = lineColumn(src, span[0]!)
    return new PeleError(message, 'semantic', { type: 'usecase', line, column })
  }

  const fail = (message: string, span: Span): never => {
    throw error(`${message} at ${at(span)}`, span)
  }

  const conflict = (message: string, current: Span, previous: Span, currentLabel?: string, previousLabel?: string): never => {
    const suffix = (label: string | undefined): string => (label === undefined ? '' : ` (label "${label}")`)
    throw error(`${message} at ${at(current)}${suffix(currentLabel)}; previous declaration at ${at(previous)}${suffix(previousLabel)}`, current)
  }

  const invalid = (id: string, kind: string, property: DraftProperty): never => fail(`Metadata property '${property.key}' is invalid for ${kind} '${id}'`, property.keySpan)

  const mention = (id: string, offset: number): void => {
    const previous = first.get(id)
    if (previous === undefined || offset < previous) first.set(id, offset)
  }

  const inOrder = <V extends { id: string }>(values: Iterable<V>): V[] => [...values].sort((a, b) => (first.get(a.id) ?? 0) - (first.get(b.id) ?? 0))

  const register = (named: Named, kind: SymbolKind): void => {
    symbols.set(named.id, { kind, span: named.span, generated: named.generated, label: named.label.text })
  }

  // An id means one thing in the whole diagram, and an id made from a label may be declared once.
  const claim = (draft: Named, kind: SymbolKind): void => {
    const origin = symbols.get(draft.id)
    if (!origin) return
    const label = draft.generated ? draft.label.text : undefined
    const originLabel = origin.generated ? origin.label : undefined
    if (origin.kind !== kind) {
      conflict(`ID '${draft.id}' is declared as both ${origin.kind} and ${kind}`, draft.span, origin.span, label, originLabel)
    }
    if (origin.generated || draft.generated) {
      conflict(`Generated ID '${draft.id}' collides with another declaration`, draft.span, origin.span, label, originLabel)
    }
  }

  const unique = (id: string, kind: SymbolKind, span: Span): void => {
    const previous = symbols.get(id)
    if (previous) {
      conflict(`ID '${id}' is declared more than once (${previous.kind} and ${kind})`, span, previous.span, undefined, previous.generated ? previous.label : undefined)
    }
    symbols.set(id, { kind, span, generated: false })
  }

  // A metadata statement replaces what a declaration said; two declarations have to agree.
  const actorProperty = (state: ElementState, property: DraftProperty, replace: boolean): void => {
    const { key, value } = property
    const clash = (previous: unknown): void => {
      if (!replace && previous !== undefined && previous !== value) {
        conflict(`Actor '${state.id}' has conflicting ${key} metadata`, property.keySpan, state.span)
      }
    }
    if (key === 'type' && (value === 'normal' || value === 'hollow' || value === 'awesome')) {
      clash(state.actorType)
      state.actorType = value
    } else if (key === 'icon' && typeof value === 'string') {
      clash(state.icon)
      state.icon = value
    } else if (key === 'business' && typeof value === 'boolean') {
      clash(state.business)
      state.business = value
    } else invalid(state.id, 'actor', property)
  }

  const elementMetadata = (state: ElementState, properties: DraftProperty[] | undefined, replace: boolean): void => {
    for (const property of properties ?? []) {
      if (state.kind === 'actor') actorProperty(state, property, replace)
      else if (property.key === 'business' && typeof property.value === 'boolean') {
        if (!replace && state.business !== undefined && state.business !== property.value) {
          conflict(`Use case '${state.id}' has conflicting business metadata`, property.keySpan, state.span)
        }
        state.business = property.value
      } else invalid(state.id, 'usecase', property)
    }
  }

  const publish = (state: ElementState): void => {
    let element: Actor | UseCase
    if (state.kind === 'actor') {
      useCases.delete(state.id)
      const actor: Actor = {
        id: state.id,
        label: state.label.text,
        labelType: state.label.type,
        business: state.business ?? false,
        classes: [...state.classes],
        type: state.icon ? 'icon' : (state.actorType ?? 'normal'),
        styles: actors.get(state.id)?.styles ?? [],
      }
      if (state.icon) actor.icon = state.icon
      actors.set(state.id, actor)
      element = actor
    } else {
      actors.delete(state.id)
      element = {
        id: state.id,
        label: state.label.text,
        labelType: state.label.type,
        business: state.business ?? false,
        classes: [...state.classes],
        shape: state.shape ?? 'ellipse',
        styles: useCases.get(state.id)?.styles ?? [],
      }
      useCases.set(state.id, element)
    }
    if (state.stereotype) element.stereotype = state.stereotype
    if (state.parent?.id) element.parentId = state.parent.id
    if (parserObservationActive('usecase')) observeParserMutation('usecase', `publish-${state.kind}`, element)
  }

  const declareElement = (draft: DraftElement): void => {
    claim(draft, draft.kind)
    const parent = draft.parent?.id ? draft.parent : undefined
    const existing = elements.get(draft.id)
    if (!existing) {
      const state: ElementState = {
        kind: draft.kind,
        id: draft.id,
        label: draft.label,
        span: draft.span,
        generated: draft.generated,
        classes: [...draft.classes],
        parent,
        shape: draft.shape,
        stereotype: draft.stereotype,
        stereotypeSpan: draft.stereotype ? draft.span : undefined,
      }
      elementMetadata(state, draft.metadata, false)
      elements.set(draft.id, state)
      register(draft, draft.kind)
      return
    }
    if (existing.label.text !== draft.label.text || existing.label.type !== draft.label.type) {
      conflict(`ID '${draft.id}' has conflicting labels`, draft.span, existing.span)
    }
    if (draft.shape && existing.shape && draft.shape !== existing.shape) {
      conflict(`Use case '${draft.id}' has conflicting shapes`, draft.span, existing.span)
    }
    // A boundary whose title makes an empty id is no parent, but it still takes the place of one.
    if (parent && existing.parent?.id && parent.id !== existing.parent.id) {
      conflict(`Element '${draft.id}' belongs to more than one system boundary`, parent.span, existing.parent.span)
    }
    if (draft.stereotype && existing.stereotype && draft.stereotype !== existing.stereotype) {
      conflict(`Element '${draft.id}' has conflicting stereotypes`, draft.span, existing.stereotypeSpan ?? existing.span)
    }
    existing.shape ??= draft.shape
    existing.parent ??= draft.parent
    existing.stereotype ??= draft.stereotype
    existing.stereotypeSpan ??= draft.stereotype ? draft.span : undefined
    pushUnique(existing.classes, draft.classes)
    elementMetadata(existing, draft.metadata, false)
  }

  const declareBoundary = (draft: DraftBoundary): void => {
    claim(draft, 'boundary')
    const existing = boundaries.get(draft.id)
    if (existing) {
      if (existing.label.text !== draft.label.text || existing.label.type !== draft.label.type) {
        conflict(`Boundary '${draft.id}' has conflicting titles`, draft.span, existing.span)
      }
      pushUnique(existing.classes, draft.classes)
      return
    }
    boundaries.set(draft.id, { ...draft, classes: [...draft.classes], members: [] })
    register(draft, 'boundary')
  }

  // An end of a relationship that nothing declares becomes a use case.
  const endpoint = (end: DraftEndpoint): SymbolKind => {
    if (end.classed && !end.declares) {
      fail(`Relationship endpoint '${end.id}' uses ::: without declaring the node`, end.span)
    }
    const origin = symbols.get(end.id)
    if (origin) return origin.kind
    elements.set(end.id, { ...end, kind: 'usecase', shape: 'ellipse', classes: [] })
    register(end, 'usecase')
    mention(end.id, end.span[0]!)
    return 'usecase'
  }

  const stylable = (id: string, span: Span): { classes: string[]; styles: string[] } => {
    const kind = symbols.get(id)?.kind
    const target = kind === 'actor' ? actors.get(id) : kind === 'usecase' ? useCases.get(id) : kind === 'boundary' ? systemBoundaries.get(id) : kind === 'json' ? model.jsonNodes.get(id) : edges.get(id)
    return target ?? fail(`Class/style target '${id}' is unresolved or anonymous`, span)
  }

  const declarations: { offset: number; run: () => void }[] = []
  for (const { source, target } of drafts.relationships) {
    mention(source.id, source.span[0]!)
    mention(target.id, target.span[0]!)
  }
  for (const draft of drafts.elements) {
    mention(draft.id, draft.span[0]!)
    declarations.push({ offset: draft.span[0]!, run: () => declareElement(draft) })
  }
  for (const draft of drafts.boundaries) {
    mention(draft.id, draft.span[0]!)
    declarations.push({ offset: draft.span[0]!, run: () => declareBoundary(draft) })
  }
  for (const draft of drafts.jsons) {
    mention(draft.id, draft.span[0]!)
    declarations.push({ offset: draft.span[0]!, run: () => unique(draft.id, 'json', draft.span) })
  }
  for (const { id, idSpan } of drafts.relationships) {
    if (id && idSpan) declarations.push({ offset: idSpan[0]!, run: () => unique(id, 'edge', idSpan) })
  }
  declarations.sort((a, b) => a.offset - b.offset)
  for (const declaration of declarations) declaration.run()

  for (const state of inOrder(elements.values())) publish(state)
  for (const state of inOrder(boundaries.values())) {
    systemBoundaries.set(state.id, {
      id: state.id,
      label: state.label.text,
      labelType: state.label.type,
      type: 'rect',
      members: [],
      classes: [],
      styles: [],
    })
  }
  for (const draft of inOrder(drafts.jsons)) {
    model.jsonNodes.set(draft.id, {
      id: draft.id,
      value: draft.value,
      propertyOrder: draft.propertyOrder,
      classes: [...draft.classes],
      styles: [],
    })
  }

  let anonymous = 0
  for (const draft of drafts.relationships) {
    const { source, target, type } = draft
    const sourceKind = endpoint(source)
    const targetKind = endpoint(target)
    const related = (kind: SymbolKind): boolean => kind === 'actor' || kind === 'usecase' || kind === 'json'
    if (!related(sourceKind)) {
      conflict(`Relationship source '${source.id}' cannot be ${sourceKind}`, source.span, symbols.get(source.id)!.span)
    }
    if (!related(targetKind)) {
      conflict(`Relationship target '${target.id}' cannot be ${targetKind}`, target.span, symbols.get(target.id)!.span)
    }
    if ((type === 'include' || type === 'extend') && (sourceKind !== 'usecase' || targetKind !== 'usecase')) {
      fail(`${type} relationship requires use-case endpoints`, draft.span)
    }
    if (type === 'generalization' && (sourceKind === 'json' || sourceKind !== targetKind)) {
      fail('Generalization requires actor-to-actor or use-case-to-use-case endpoints', draft.span)
    }
    if (type === 'association' && (sourceKind === 'json' || targetKind === 'json') && draft.arrowType > 2) {
      fail(`JSON relationship '${source.id}' to '${target.id}' permits only point, reversed-point, or markerless solid association`, draft.span)
    }
    const id = draft.id ?? `edge-${anonymous++}`
    const relationship: Relationship = {
      id,
      explicitId: Boolean(draft.id),
      source: source.id,
      target: target.id,
      type,
      arrowType: draft.arrowType,
      minlen: draft.minlen,
      classes: [],
      styles: [],
      animate: false,
    }
    if (draft.label) {
      relationship.label = draft.label.text
      relationship.labelType = draft.label.type
    }
    model.relationships.push(relationship)
    if (parserObservationActive('usecase')) observeParserMutation('usecase', 'add-relationship', relationship)
    edges.set(id, relationship)
  }

  // The relationships may have added use cases; put all elements back in the order of first mention.
  const declaredActors = new Map(actors)
  const declaredUseCases = new Map(useCases)
  actors.clear()
  useCases.clear()
  for (const state of inOrder(elements.values())) {
    const actor = declaredActors.get(state.id)
    const useCase = declaredUseCases.get(state.id)
    if (actor) actors.set(state.id, actor)
    else if (useCase) useCases.set(state.id, useCase)
    else publish(state)
  }

  for (const { target, span, properties, statement } of drafts.metadata) {
    const origin = symbols.get(target)
    if (!origin) {
      const inferred = inferKind(properties)
      return fail(`Metadata target '${target}' is unresolved${inferred ? ` (metadata implies ${inferred})` : ''}`, span)
    }
    const kind = origin.kind
    if (kind === 'actor' || kind === 'usecase') elementMetadata(elements.get(target)!, properties, true)
    else if (kind === 'edge') {
      statement.kind = 'edgeMetadata'
      statement.edges = [{ id: target, span: statement.span, idSpan: span, metadata: statement.metadata }]
      delete statement.nodes
    }
    const boundary = boundaries.get(target)
    const edge = edges.get(target)
    for (const property of kind === 'actor' || kind === 'usecase' ? [] : properties) {
      const { key, value } = property
      if (kind === 'boundary' && boundary && key === 'type' && (value === 'rect' || value === 'package')) {
        boundary.type = value
      } else if (kind === 'edge' && edge && key === 'animate' && typeof value === 'boolean') edge.animate = value
      else if (kind === 'edge' && edge && key === 'animation' && (value === 'fast' || value === 'slow')) {
        edge.animation = value as Animation
        edge.animate = true
      } else invalid(target, kind, property)
    }
  }
  for (const relationship of model.relationships) if (relationship.animation) relationship.animate = true

  for (const state of elements.values()) {
    if (state.kind === 'actor') {
      if (state.icon && state.actorType && state.actorType !== 'normal') {
        fail(`Actor '${state.id}' cannot combine icon with type '${state.actorType}'`, state.span)
      }
      if (state.business && (state.icon || state.actorType === 'awesome')) {
        fail(`Business actor '${state.id}' must use normal or hollow geometry`, state.span)
      }
    } else if (state.shape === 'rect' && state.business) {
      fail(`Rectangular use case '${state.id}' cannot be a business use case`, state.span)
    }
    publish(state)
  }

  for (const draft of [...drafts.elements].sort((a, b) => a.span[0]! - b.span[0]!)) {
    if (!draft.parent?.id) continue
    const members = boundaries.get(draft.parent.id)!.members
    if (!members.includes(draft.id)) members.push(draft.id)
  }
  for (const state of boundaries.values()) {
    const boundary = systemBoundaries.get(state.id)!
    boundary.type = state.type ?? 'rect'
    boundary.members = state.members
    boundary.classes = [...state.classes]
  }

  let notes = 0
  for (const draft of drafts.notes) {
    const origin = symbols.get(draft.target)
    if (!origin) return fail(`Note target '${draft.target}' is unresolved`, draft.span)
    if (origin.kind !== 'actor' && origin.kind !== 'usecase') {
      conflict(`Note target '${draft.target}' must be an actor or use case, not ${origin.kind}`, draft.span, origin.span)
    }
    const id = `note-${notes++}`
    model.notes.set(id, { id, target: draft.target, label: draft.label.text, labelType: draft.label.type })
  }

  for (const definition of drafts.classDefs) {
    for (const id of definition.ids) model.classDefs.set(id, { id, styles: [...definition.styles] })
  }
  for (const assignment of drafts.classes) {
    for (const target of assignment.targets) pushUnique(stylable(target.id, target.span).classes, assignment.classes)
  }
  for (const assignment of drafts.styles) {
    stylable(assignment.target, assignment.span).styles.push(...assignment.styles)
  }

  model.direction = drafts.direction ?? model.direction
  model.title = title
  model.accTitle = drafts.accTitle
  model.accDescription = drafts.accDescription
  model.accDescr = drafts.accDescription.replace(/\n\s+/g, '\n')
  model.source = src
  model.headerSpan = headerSpan
  model.statements = statements
  return model
}
