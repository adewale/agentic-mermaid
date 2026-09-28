// Model-based (stateful) test of the typed ER editing API with fc.commands.
//
// agent.test.ts already drives flowchart mutations against a shadow model;
// this covers the ER family's ops (add/remove/rename entity, entity label,
// add/remove attribute, add/remove relation) against a plain model: a map of
// entities and a list of relations. Every command runs whether or not it
// should succeed, and the model predicts the outcome: a refused op must name
// the model's error code and leave the diagram untouched. After every command
// the diagram's semantic facts must equal the model's, and serialize → re-parse
// must reproduce those facts and serialize to the same bytes.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asEr, describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import type { ErCardinality, ErMutationOp, ErValidDiagram, ParsedDiagram } from '../agent/types.ts'

type ModelEntity = { label?: string; attributes: string[] }
type ModelRelation = { from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed: boolean; label?: string }
type Model = { entities: Map<string, ModelEntity>; relations: ModelRelation[] }
type Real = { diagram: ErValidDiagram }

/** The facts describeMermaidFacts must report for a model (facts.ts factsEr). */
function modelFacts(model: Model): string[] {
  const facts = new Set(['family er'])
  for (const [id, entity] of model.entities) {
    facts.add(`entity ${id}${entity.label ? ` label ${entity.label}` : ''}`)
    for (const attribute of entity.attributes) facts.add(`attribute ${id} ${attribute}`)
  }
  model.relations.forEach((relation, index) => {
    const line = `${relation.from} ${relation.leftCard} ${relation.dashed ? '..' : '--'} ${relation.rightCard} ${relation.to}${relation.label ? ` : ${relation.label}` : ''}`
    facts.add(`relation ${line}`)
    facts.add(`relation#${index} ${line}`)
  })
  return [...facts].sort()
}

/** The typed body in model shape (entities by id; relations in order). */
function bodyAsModel(diagram: ParsedDiagram): Model {
  const body = asEr(diagram)?.body
  if (!body) throw new Error(`expected a structured ER body, got ${diagram.body.kind}`)
  return {
    entities: new Map(
      [...body.entities]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(entity => [entity.id, { ...(entity.label ? { label: entity.label } : {}), attributes: entity.attributes.map(attribute => attribute.text) }]),
    ),
    relations: body.relations.map(({ from, to, leftCard, rightCard, dashed, label }) => ({ from, to, leftCard, rightCard, dashed, ...(label ? { label } : {}) })),
  }
}

function sortedModel(model: Model): Model {
  return { entities: new Map([...model.entities].sort(([a], [b]) => a.localeCompare(b))), relations: model.relations }
}

function assertConforms(model: Model, real: Real): void {
  expect(describeMermaidFacts(real.diagram)).toEqual(modelFacts(model))
  expect(bodyAsModel(real.diagram)).toEqual(sortedModel(model))

  const source = serializeMermaid(real.diagram)
  const reparsed = parseRegisteredMermaid(source)
  expect({ source, ok: reparsed.ok }).toEqual({ source, ok: true })
  if (!reparsed.ok) return
  expect({ source, facts: describeMermaidFacts(reparsed.value) }).toEqual({ source, facts: modelFacts(model) })
  expect(serializeMermaid(reparsed.value)).toBe(source)
}

/** The error code the model predicts for an op, or null when it must succeed (er-body.ts mutateEr). */
function predictedError(model: Model, op: ErMutationOp): string | null {
  const has = (id: string) => model.entities.has(id)
  switch (op.kind) {
    case 'add_entity': return has(op.id) ? 'DUPLICATE_ENTITY' : null
    case 'remove_entity': return has(op.id) ? null : 'ENTITY_NOT_FOUND'
    case 'rename_entity': return !has(op.from) ? 'ENTITY_NOT_FOUND' : has(op.to) ? 'DUPLICATE_ENTITY' : null
    case 'set_entity_label': return has(op.entity) ? null : 'ENTITY_NOT_FOUND'
    case 'add_attribute': return has(op.entity) ? null : 'ENTITY_NOT_FOUND'
    case 'remove_attribute': {
      const entity = model.entities.get(op.entity)
      return !entity ? 'ENTITY_NOT_FOUND' : op.index >= entity.attributes.length ? 'ATTRIBUTE_NOT_FOUND' : null
    }
    case 'add_relation': return has(op.from) && has(op.to) ? null : 'ENTITY_NOT_FOUND'
    case 'remove_relation': return op.index < model.relations.length ? null : 'RELATION_NOT_FOUND'
    default: throw new Error(`the model does not cover ${op.kind}`)
  }
}

/** Apply a succeeding op to the model. */
function applyToModel(model: Model, op: ErMutationOp): void {
  switch (op.kind) {
    case 'add_entity':
      model.entities.set(op.id, { ...(op.label ? { label: op.label } : {}), attributes: [...(op.attributes ?? [])] })
      break
    case 'remove_entity':
      model.entities.delete(op.id)
      model.relations = model.relations.filter(relation => relation.from !== op.id && relation.to !== op.id)
      break
    case 'rename_entity':
      model.entities = new Map([...model.entities].map(([id, entity]) => [id === op.from ? op.to : id, entity]))
      for (const relation of model.relations) {
        if (relation.from === op.from) relation.from = op.to
        if (relation.to === op.from) relation.to = op.to
      }
      break
    case 'set_entity_label': {
      const entity = model.entities.get(op.entity)!
      if (op.label === null) delete entity.label
      else entity.label = op.label
      break
    }
    case 'add_attribute':
      model.entities.get(op.entity)!.attributes.push(op.text)
      break
    case 'remove_attribute':
      model.entities.get(op.entity)!.attributes.splice(op.index, 1)
      break
    case 'add_relation':
      model.relations.push({ from: op.from, to: op.to, leftCard: op.leftCard, rightCard: op.rightCard, dashed: op.dashed ?? false, ...(op.label ? { label: op.label } : {}) })
      break
    case 'remove_relation':
      model.relations.splice(op.index, 1)
      break
    default:
      throw new Error(`the model does not cover ${op.kind}`)
  }
}

class ErCommand implements fc.Command<Model, Real> {
  constructor(private readonly op: ErMutationOp) {}

  check(): boolean {
    return true // refused ops are part of the contract under test
  }

  run(model: Model, real: Real): void {
    const expectedError = predictedError(model, this.op)
    const before = serializeMermaid(real.diagram)
    const result = mutate(real.diagram, this.op)
    if (expectedError) {
      expect({ op: this.op, error: result.ok ? 'accepted' : (result.error as { code: string }).code }).toEqual({ op: this.op, error: expectedError })
      expect(serializeMermaid(real.diagram)).toBe(before) // a refusal never edits in place
    } else {
      expect({ op: this.op, ok: result.ok, error: result.ok ? undefined : result.error }).toEqual({ op: this.op, ok: true, error: undefined })
      if (!result.ok) return
      real.diagram = result.value as ErValidDiagram
      applyToModel(model, this.op)
    }
    assertConforms(model, real)
  }

  toString(): string {
    return JSON.stringify(this.op)
  }
}

const ids = fc.constantFrom('CUSTOMER', 'ORDER', 'LINE-ITEM', 'Product', 'b2')
const words = fc.array(fc.constantFrom('Buyer', 'order', 'Line', 'item', 'Big', 'x7'), { minLength: 1, maxLength: 3 }).map(parts => parts.join(' '))
const attribute = fc
  .tuple(
    fc.constantFrom('string', 'int', 'float', 'bool'),
    fc.constantFrom('id', 'name', 'createdAt', 'total_1'),
    fc.constantFrom('', ' PK', ' FK', ' UK', ' PK, FK'),
    fc.constantFrom('', ' "note"', ' "a longer comment"'),
  )
  .map(([type, name, keys, comment]) => `${type} ${name}${keys}${comment}`)
const cardinality = fc.constantFrom<ErCardinality>('one-only', 'zero-or-one', 'zero-or-many', 'one-or-many')
const index = fc.nat({ max: 4 })

const commands = [
  fc.record({ id: ids, label: fc.option(words, { nil: undefined }), attributes: fc.array(attribute, { maxLength: 2 }) })
    .map(({ id, label, attributes }) => new ErCommand({ kind: 'add_entity', id, ...(label ? { label } : {}), attributes })),
  ids.map(id => new ErCommand({ kind: 'remove_entity', id })),
  fc.tuple(ids, ids).map(([from, to]) => new ErCommand({ kind: 'rename_entity', from, to })),
  fc.tuple(ids, fc.option(words, { nil: null })).map(([entity, label]) => new ErCommand({ kind: 'set_entity_label', entity, label })),
  fc.tuple(ids, attribute).map(([entity, text]) => new ErCommand({ kind: 'add_attribute', entity, text })),
  fc.tuple(ids, index).map(([entity, at]) => new ErCommand({ kind: 'remove_attribute', entity, index: at })),
  fc.record({ from: ids, to: ids, leftCard: cardinality, rightCard: cardinality, dashed: fc.boolean(), label: fc.option(words, { nil: undefined }) })
    .map(({ label, ...relation }) => new ErCommand({ kind: 'add_relation', ...relation, ...(label ? { label } : {}) })),
  index.map(at => new ErCommand({ kind: 'remove_relation', index: at })),
]

// Every entity is declared by its own statement: see the known bug below for
// what happens to an entity that only a relation mentions.
const INITIAL = 'erDiagram\n  CUSTOMER\n  ORDER {\n    int id PK\n  }\n  CUSTOMER ||--o{ ORDER : places'

// KNOWN BUG, found by this model test and pinned rather than fixed here: an
// entity that only a relation's endpoint declares vanishes from the serialized
// source once that relation is removed (remove_relation, or remove_entity on
// the other endpoint), although the typed body and its facts still list it:
//   erDiagram\n  A ||--o{ B : x   + remove_relation 0   →   "erDiagram\n"
// The model property steers around it by declaring every entity explicitly.
// Once fixed, the pinned test below turns red: delete it and the steering.
const IMPLIED_ENTITY_LOSS = { source: 'erDiagram\n  A ||--o{ B : x', op: { kind: 'remove_relation', index: 0 } } as const

describe('ER typed editing API against a shadow model', () => {
  test('known bug: an entity only a relation declared is lost on serialize after that relation goes', () => {
    const parsed = parseRegisteredMermaid(IMPLIED_ENTITY_LOSS.source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = mutate(parsed.value, IMPLIED_ENTITY_LOSS.op)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(describeMermaidFacts(result.value)).toEqual(['entity A', 'entity B', 'family er'])
    const serialized = serializeMermaid(result.value)
    expect(serialized).toBe('erDiagram\n')
    const reparsed = parseRegisteredMermaid(serialized)
    expect(reparsed.ok && describeMermaidFacts(reparsed.value)).toEqual(['family er'])
  })

  test('the initial diagram matches its model', () => {
    const real = { diagram: initialDiagram() }
    assertConforms(initialModel(), real)
  })

  test('property: any command sequence keeps facts, body and round-trip in step with the model', () => {
    fc.assert(
      fc.property(fc.commands(commands, { maxCommands: 20, size: 'max' }), sequence => {
        fc.modelRun(() => ({ model: initialModel(), real: { diagram: initialDiagram() } }), sequence)
      }),
      { numRuns: 100 },
    )
  })
})

function initialDiagram(): ErValidDiagram {
  const parsed = parseRegisteredMermaid(INITIAL)
  if (!parsed.ok) throw new Error('initial ER diagram failed to parse')
  const er = asEr(parsed.value)
  if (!er) throw new Error('initial ER diagram is not structured')
  return er
}

function initialModel(): Model {
  return {
    entities: new Map<string, ModelEntity>([
      ['CUSTOMER', { attributes: [] }],
      ['ORDER', { attributes: ['int id PK'] }],
    ]),
    relations: [{ from: 'CUSTOMER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many', dashed: false, label: 'places' }],
  }
}
