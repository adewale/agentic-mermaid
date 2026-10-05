// Model-based (stateful) test of the typed ER editing API with fc.commands.
//
// agent.test.ts already drives flowchart mutations against a shadow model;
// this covers the ER family's ops (add/remove/rename entity, entity label,
// add/remove attribute, add/remove relation, entity class and style) against
// a plain model: an ordered map of entities, each with its subgraph, and a
// list of relations. Every command runs whether or not it should succeed, and
// the model predicts the outcome: a refused op must name the model's error
// code and leave the diagram untouched. After every command the diagram's
// semantic facts and entities (in order, with their subgraphs) must equal the
// model's, and serialize → re-parse must reproduce both and serialize to the
// same bytes.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asEr, describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import type { ErCardinality, ErMutationOp, ErValidDiagram, ParsedDiagram } from '../agent/types.ts'

type ModelEntity = { label?: string; attributes: string[]; group?: string; className?: string; styled?: true }
type ModelRelation = { from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed: boolean; label?: string }
/** Entities in body order; no op adds, removes or moves a subgraph. */
type Model = { entities: Map<string, ModelEntity>; relations: ModelRelation[] }
type Real = { diagram: ErValidDiagram }

/** The facts describeMermaidFacts must report for a model (facts.ts factsEr). */
function modelFacts(model: Model): string[] {
  const facts = new Set(['family er', 'er group G label G'])
  for (const [id, entity] of model.entities) {
    facts.add(`entity ${id}${entity.label ? ` label ${entity.label}` : ''}${entity.group ? ` group ${entity.group}` : ''}`)
    if (entity.className) facts.add(`entity ${id} class ${entity.className}`)
    if (entity.styled) facts.add(`entity ${id} styled`)
    for (const attribute of entity.attributes) facts.add(`attribute ${id} ${attribute}`)
  }
  model.relations.forEach((relation, index) => {
    const line = `${relation.from} ${relation.leftCard} ${relation.dashed ? '..' : '--'} ${relation.rightCard} ${relation.to}${relation.label ? ` : ${relation.label}` : ''}`
    facts.add(`relation ${line}`)
    facts.add(`relation#${index} ${line}`)
  })
  return [...facts].sort()
}

/** The typed body in model shape, entities as ordered entries (Map equality ignores order). */
function bodyAsModel(diagram: ParsedDiagram) {
  const body = asEr(diagram)?.body
  if (!body) throw new Error(`expected a structured ER body, got ${diagram.body.kind}`)
  return {
    entities: body.entities.map(entity => [entity.id, {
      ...(entity.label ? { label: entity.label } : {}),
      attributes: entity.attributes.map(attribute => attribute.text),
      ...(entity.groupId ? { group: entity.groupId } : {}),
      ...(entity.className ? { className: entity.className } : {}),
      ...(entity.style ? { styled: true } : {}),
    }]),
    relations: body.relations.map(({ from, to, leftCard, rightCard, dashed, label }) => ({ from, to, leftCard, rightCard, dashed, ...(label ? { label } : {}) })),
  }
}

function modelShape(model: Model): ReturnType<typeof bodyAsModel> {
  return { entities: [...model.entities], relations: model.relations }
}

function assertConforms(model: Model, real: Real): void {
  expect(describeMermaidFacts(real.diagram)).toEqual(modelFacts(model))
  expect(bodyAsModel(real.diagram)).toEqual(modelShape(model))

  const source = serializeMermaid(real.diagram)
  const reparsed = parseRegisteredMermaid(source)
  expect({ source, ok: reparsed.ok }).toEqual({ source, ok: true })
  if (!reparsed.ok) return
  expect({ source, facts: describeMermaidFacts(reparsed.value) }).toEqual({ source, facts: modelFacts(model) })
  expect({ source, body: bodyAsModel(reparsed.value) }).toEqual({ source, body: modelShape(model) })
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
    case 'set_entity_class':
    case 'set_entity_style': return has(op.entity) ? null : 'ENTITY_NOT_FOUND'
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
    case 'set_entity_class': {
      const entity = model.entities.get(op.entity)!
      if (op.className === null) delete entity.className
      else entity.className = op.className
      break
    }
    case 'set_entity_style': {
      const entity = model.entities.get(op.entity)!
      if (op.style === null) delete entity.styled
      else entity.styled = true
      break
    }
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
  fc.tuple(ids, fc.option(fc.constantFrom('hot', 'cold-1'), { nil: null })).map(([entity, className]) => new ErCommand({ kind: 'set_entity_class', entity, className })),
  fc.tuple(ids, fc.option(fc.constantFrom('fill:#f00', 'fill:#0f0,stroke:#333'), { nil: null })).map(([entity, style]) => new ErCommand({ kind: 'set_entity_style', entity, style })),
]

// Removing `places` leaves ORDER, which it put in G, declared only at top
// level, and CUSTOMER, which it created inside G, only in the top-level
// `bills` (as removing ORDER does). Removing `ships` leaves b2, created before
// G's entities, with no statement. LINE-ITEM is declared only by `bills`, and
// Product only by its `style` line. Each must keep its subgraph and position.
const INITIAL = [
  'erDiagram',
  '  ORDER {',
  '    int id PK',
  '  }',
  '  b2 ||--o{ ORDER : ships',
  '  subgraph G',
  '  CUSTOMER ||--o{ ORDER : places',
  '  end',
  '  LINE-ITEM }|--|| CUSTOMER : bills',
  '  style Product fill:#f00',
  '',
].join('\n')

describe('ER typed editing API against a shadow model', () => {
  test('an entity only a relation declared survives serialization after that relation goes', () => {
    const cases = [
      { source: 'erDiagram\n  A ||--o{ B : x', op: { kind: 'remove_relation', index: 0 }, serialized: 'erDiagram\n  A\n  B\n' },
      { source: 'erDiagram\n  A ||--o{ B : x', op: { kind: 'remove_entity', id: 'A' }, serialized: 'erDiagram\n  B\n' },
      // Declared where they were created, so the entity order survives too.
      { source: 'erDiagram\n  A ||--o{ B : x\n  C ||--o{ D : y', op: { kind: 'remove_relation', index: 0 }, serialized: 'erDiagram\n  A\n  B\n  C ||--o{ D : y\n' },
      { source: 'erDiagram\n  subgraph G\n    A["Alpha"] ||--o{ B : x\n  end', op: { kind: 'remove_relation', index: 0 }, serialized: 'erDiagram\n  subgraph G\n  A["Alpha"]\n  B\n  end\n' },
      // A `style` line re-creates A, but not its label.
      { source: 'erDiagram\n  A["Alpha"] ||--o{ B : x\n  style A fill:#f00', op: { kind: 'remove_relation', index: 0 }, serialized: 'erDiagram\n  A["Alpha"]\n  B\n  style A fill:#f00\n' },
    ] as const
    for (const { source, op, serialized } of cases) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`rejected:\n${source}`)
      const result = mutate(parsed.value, op)
      if (!result.ok) throw new Error(`${op.kind} refused on:\n${source}`)
      expect({ source, op, serialized: serializeMermaid(result.value) }).toEqual({ source, op, serialized })
      const reparsed = parseRegisteredMermaid(serialized)
      if (!reparsed.ok) throw new Error(`serialized source rejected:\n${serialized}`)
      expect(asEr(reparsed.value)?.body.entities).toEqual(asEr(result.value)?.body.entities)
      expect(describeMermaidFacts(reparsed.value)).toEqual(describeMermaidFacts(result.value))
    }
    // An entity that only a `style` line creates round-trips untouched as before.
    const styled = parseRegisteredMermaid('erDiagram\n  style A fill:#f00')
    expect(styled.ok && serializeMermaid(styled.value)).toBe('erDiagram\n  style A fill:#f00\n')
  })

  test('an entity keeps its subgraph and position when the relation that placed it goes', () => {
    // BUG-8: `x` created A inside G; the top-level `y` alone would re-create it outside G, after H.
    expectRoundTrip(
      'erDiagram\n  subgraph G\n    A ||--o{ B : x\n  end\n  H ||--o{ A : y',
      [{ kind: 'remove_relation', index: 0 }],
      'erDiagram\n  subgraph G\n  A\n  B\n  end\n  H ||--o{ A : y\n',
      ['A in G', 'B in G', 'H'],
    )
    // A's own declaration is at top level and only `x` put it in G, so it is
    // declared in G a second time, which re-parse does not keep as a statement.
    expectRoundTrip(
      'erDiagram\n  A {\n    int id PK\n  }\n  subgraph G\n    A ||--o{ B : x\n  end\n  H ||--o{ A : y',
      [{ kind: 'remove_relation', index: 0 }],
      'erDiagram\n  A {\n    int id PK\n  }\n  subgraph G\n  B\n  A\n  end\n  H ||--o{ A : y\n',
      ['A in G', 'B in G', 'H'],
    )
    // Y and Z precede G's entities, so they are declared before G opens.
    expectRoundTrip(
      'erDiagram\n  Y ||--o{ Z : a\n  subgraph G\n    X ||--o{ W : b\n  end',
      [{ kind: 'remove_relation', index: 0 }],
      'erDiagram\n  Y\n  Z\n  subgraph G\n  X ||--o{ W : b\n  end\n',
      ['Y', 'Z', 'X in G', 'W in G'],
    )
  })

  test('add_attribute declares the entity after the statement that creates it', () => {
    // BUG-9: declaring B before the relation that creates D and B re-parsed
    // as B before D, once D's subgraph kept the serializer from moving it.
    expectRoundTrip(
      'erDiagram\n  D ||--o{ B : r\n  subgraph G\n    D ||--o{ B : s\n  end',
      [{ kind: 'add_attribute', entity: 'B', text: 'int id' }],
      'erDiagram\n  D ||--o{ B : r\n  B {\n    int id\n  }\n  subgraph G\n  D ||--o{ B : s\n  end\n',
      ['D in G', 'B in G'],
    )
  })

  test('a class on an entity that only its style line creates survives serialization', () => {
    // `class` applies only to an entity that already exists, so it follows the `style` line.
    expectRoundTrip('erDiagram\n  style A fill:#f00\n  class A hot', [], 'erDiagram\n  style A fill:#f00\n  class A hot\n', ['A'])
    expectRoundTrip(
      'erDiagram\n  B ||--o{ A : x\n  style A fill:#f00',
      [{ kind: 'set_entity_class', entity: 'A', className: 'hot' }, { kind: 'remove_relation', index: 0 }],
      'erDiagram\n  B\n  style A fill:#f00\n  class A hot\n',
      ['B', 'A'],
    )
    // A declared entity keeps `class` before `style`.
    expectRoundTrip('erDiagram\n  A\n  class A hot\n  style A fill:#f00', [], 'erDiagram\n  A\n  class A hot\n  style A fill:#f00\n', ['A'])
  })

  test('the initial diagram matches its model and serializes to its own source', () => {
    const real = { diagram: initialDiagram() }
    assertConforms(initialModel(), real)
    expect(serializeMermaid(real.diagram)).toBe(INITIAL)
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

/** Apply `ops` to `source` and pin the serialized text; re-parsing it must give
 * back the same entities (order and subgraphs included), facts and bytes. */
function expectRoundTrip(source: string, ops: ErMutationOp[], serialized: string, entities: string[]): void {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`rejected:\n${source}`)
  let diagram: ParsedDiagram = parsed.value
  for (const op of ops) {
    const result = mutate(diagram, op)
    if (!result.ok) throw new Error(`${op.kind} refused on:\n${source}`)
    diagram = result.value
  }
  expect({ source, ops, serialized: serializeMermaid(diagram) }).toEqual({ source, ops, serialized })
  const reparsed = parseRegisteredMermaid(serialized)
  if (!reparsed.ok) throw new Error(`serialized source rejected:\n${serialized}`)
  const body = asEr(reparsed.value)?.body
  expect({ source, entities: body?.entities.map(entity => entity.groupId ? `${entity.id} in ${entity.groupId}` : entity.id) }).toEqual({ source, entities })
  expect(body?.entities).toEqual(asEr(diagram)?.body.entities)
  expect(describeMermaidFacts(reparsed.value)).toEqual(describeMermaidFacts(diagram))
  expect(serializeMermaid(reparsed.value)).toBe(serialized)
}

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
      ['ORDER', { attributes: ['int id PK'], group: 'G' }],
      ['b2', { attributes: [] }],
      ['CUSTOMER', { attributes: [], group: 'G' }],
      ['LINE-ITEM', { attributes: [] }],
      ['Product', { attributes: [], styled: true }],
    ]),
    relations: [
      { from: 'b2', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many', dashed: false, label: 'ships' },
      { from: 'CUSTOMER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many', dashed: false, label: 'places' },
      { from: 'LINE-ITEM', to: 'CUSTOMER', leftCard: 'one-or-many', rightCard: 'one-only', dashed: false, label: 'bills' },
    ],
  }
}
