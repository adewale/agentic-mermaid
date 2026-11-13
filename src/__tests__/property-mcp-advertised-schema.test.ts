// Property: tools/list advertises a compact projection of each render tool's
// canonical input schema (no vendor annotations; a role-style record becomes
// the shared record plus its allowed property names), and that projection
// accepts exactly the argument values the canonical schema accepts. An agent
// or client validating against the advertised schema must never be told a
// call is valid that the canonical schema refuses, or the reverse. Ajv is the
// independent oracle, in the 2020-12 dialect the schemas are written in and in
// draft-07, the MCP TypeScript SDK's client default. Server-side validation
// keeps the canonical schema and its runtime validators (see the error-path
// tests in hosted-mcp, agent-mcp-png and png-output-options-contract).
// Seed pinned globally (fc-seed.preload.ts).
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import Ajv2020 from 'ajv/dist/2020'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { fcParameters } from './helpers/fc-parameters.ts'

import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import { mcpToolValidationSchema } from '../mcp/tool-surface.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonRecord = { [key: string]: Json }
type SchemaNode = Record<string, any>

const NUM_RUNS = 2_000
const SOURCE = 'flowchart TD\n  A --> B'

const ajv2020 = new Ajv2020({ strict: false })
const sdkDraft07 = new AjvJsonSchemaValidator()
const DIALECTS = [
  { name: 'JSON Schema 2020-12', compile: (schema: SchemaNode) => { const check = ajv2020.compile(schema); return (value: unknown) => check(value) as boolean } },
  { name: 'draft-07 (MCP SDK default)', compile: (schema: SchemaNode) => { const check = sdkDraft07.getValidator(schema as never); return (value: unknown) => check(value).valid } },
]

// Every render tool on both surfaces, one entry per distinct advertised schema.
const RENDER_TOOLS = [...LOCAL_TOOLS, ...HOSTED_TOOLS]
  .filter(tool => tool.name.startsWith('render_'))
  .filter((tool, index, tools) => tools.findIndex(other => other.inputSchema === tool.inputSchema) === index)
  .map((tool, index) => {
    const canonical = mcpToolValidationSchema(tool) as SchemaNode
    const advertised = tool.inputSchema as SchemaNode
    return {
      label: `${tool.name}#${index}`,
      canonical,
      checks: DIALECTS.map(dialect => ({ dialect: dialect.name, canonical: dialect.compile(canonical), advertised: dialect.compile(advertised) })),
    }
  })

function agreement(toolIndex: number, value: unknown) {
  const tool = RENDER_TOOLS[toolIndex]!
  return tool.checks.map(check => ({ tool: tool.label, dialect: check.dialect, canonical: check.canonical(value), advertised: check.advertised(value) }))
}
const expectAgreement = (rows: ReturnType<typeof agreement>, value: unknown) => {
  for (const row of rows) expect({ ...row, value }).toEqual({ ...row, advertised: row.canonical, value })
}

// Input domains come from the canonical schema: role names, role property
// names, StyleSpec and option field names, each tool's own fields, plus names
// no schema allows.
const DEFS = RENDER_TOOLS[0]!.canonical.$defs as Record<string, SchemaNode>
const resolve = (node: SchemaNode): SchemaNode => typeof node.$ref === 'string' ? resolve(DEFS[node.$ref.replace('#/$defs/', '')]!) : node
const ROLE_RECORDS: Record<string, SchemaNode> = Object.fromEntries(
  Object.entries(DEFS.styleSpec!.properties.roles.properties as Record<string, SchemaNode>).map(([role, ref]) => [role, resolve(ref)]),
)
const ROLE_NAMES = Object.keys(ROLE_RECORDS)
const SHARED_ROLE_PROPERTIES = DEFS['roleStyle-any']!.properties as Record<string, SchemaNode>
const JUNK_NAMES = ['nope', 'x-agentic-mermaid-terminal', 'constructor', '$ref', 'propertyNames', 'allOf']
const KEY_DOMAIN = [...new Set([
  ...ROLE_NAMES,
  ...Object.keys(SHARED_ROLE_PROPERTIES),
  ...Object.keys(DEFS.styleSpec!.properties),
  ...RENDER_TOOLS.flatMap(tool => [...Object.keys(tool.canonical.properties), ...Object.keys(tool.canonical.properties.options.properties)]),
  ...JUNK_NAMES,
])]

/** A value the property's own schema admits (Ajv ignores runtime validators). */
function admittedValue(schema: SchemaNode): Json {
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (schema.type === 'number' || schema.type === 'integer') {
    const low = schema.minimum ?? (schema.exclusiveMinimum === undefined ? 1 : schema.exclusiveMinimum + 1)
    return schema.maximum === undefined ? low : Math.min(low, schema.maximum)
  }
  if (schema.type === 'boolean') return true
  return 'red'
}
const wrongTypeValue = (schema: SchemaNode): Json => schema.type === 'string' ? 7 : 'seven'

const VALUE_DOMAIN: readonly Json[] = [
  'red', '#fff', 'pattern', 'solid', 'hand-drawn', '', 0, 1, 2.5, -1, 1_000, true, false, null,
  [], {}, ['hand-drawn'], { fillColor: 'red' }, { node: { fillColor: 'red' } },
]

const roleRecordArb = (role: string) => {
  const properties = ROLE_RECORDS[role]!.properties as Record<string, SchemaNode>
  return fc.subarray(Object.keys(properties), { minLength: 1 })
    .map(names => Object.fromEntries(names.map(name => [name, admittedValue(properties[name]!)])) as JsonRecord)
}
// Known-valid argument records: a StyleSpec with one to three role records of
// applicable properties, alone or in a stack after a registered Look.
const validArgumentsArb = fc.uniqueArray(fc.constantFrom(...ROLE_NAMES), { minLength: 1, maxLength: 3 })
  .chain(roles => fc.record({
    records: fc.tuple(...roles.map(roleRecordArb)),
    shape: fc.constantFrom('record', 'stack', 'look-stack'),
  }).map(({ records, shape }): JsonRecord => {
    const spec: JsonRecord = { roles: Object.fromEntries(roles.map((role, index) => [role, records[index]!])) }
    const style: Json = shape === 'record' ? spec : shape === 'stack' ? [spec] : ['hand-drawn', spec]
    return { source: SOURCE, options: { style } }
  }))

type Mutation = { kind: 'insert' | 'drop' | 'retype'; at: number; slot: number; key: string; value: Json }
const mutationArb: fc.Arbitrary<Mutation> = fc.record({
  kind: fc.constantFrom('insert', 'drop', 'retype'),
  at: fc.nat(),
  slot: fc.nat(),
  key: fc.constantFrom(...KEY_DOMAIN),
  value: fc.constantFrom(...VALUE_DOMAIN),
})

/** Insert a key from the domain, drop a key, or swap a value's type. */
function mutate(original: JsonRecord, mutations: readonly Mutation[]): JsonRecord {
  const root = structuredClone(original)
  for (const mutation of mutations) {
    const nodes: Array<{ node: Json; parent?: JsonRecord | Json[]; key?: string | number }> = []
    const walk = (node: Json, parent?: JsonRecord | Json[], key?: string | number) => {
      nodes.push({ node, parent, key })
      if (Array.isArray(node)) node.forEach((child, index) => walk(child, node, index))
      else if (node && typeof node === 'object') for (const [name, child] of Object.entries(node)) walk(child, node, name)
    }
    walk(root)
    const records = nodes.filter((entry): entry is { node: JsonRecord } => !!entry.node && typeof entry.node === 'object' && !Array.isArray(entry.node))
    const target = records[mutation.at % records.length]!.node
    if (mutation.kind === 'insert') target[mutation.key] = structuredClone(mutation.value)
    else if (mutation.kind === 'drop') {
      const keys = Object.keys(target)
      if (keys.length > 0) delete target[keys[mutation.slot % keys.length]!]
    } else {
      // Earlier drops can leave the root empty, with no value to retype.
      const children = nodes.filter(entry => entry.parent !== undefined)
      if (children.length === 0) continue
      const { parent, key } = children[mutation.at % children.length]!
      ;(parent as Record<string | number, Json>)[key!] = structuredClone(mutation.value)
    }
  }
  return root
}

type Case = [toolIndex: number, args: JsonRecord, mutations: Mutation[]]
const caseArb: fc.Arbitrary<Case> = fc.tuple(
  fc.nat({ max: RENDER_TOOLS.length - 1 }),
  validArgumentsArb,
  fc.array(mutationArb, { maxLength: 3 }),
)
// Finder-mode reduction of a generator mistake: two drops empty the root,
// leaving nothing to retype.
const EMPTIED_ROOT_CASE: Case = [0, { source: SOURCE, options: { style: { roles: { node: { borderColor: 'red' } } } } }, [
  { kind: 'drop', at: 0, slot: 0, key: 'node', value: 'red' },
  { kind: 'drop', at: 0, slot: 0, key: 'node', value: 'red' },
  { kind: 'retype', at: 0, slot: 0, key: 'node', value: 'red' },
]]

describe('advertised MCP render schemas', () => {
  test('admit exactly the role properties the canonical schema admits, for every role', () => {
    let admitted = 0
    let refused = 0
    for (const [toolIndex] of RENDER_TOOLS.entries()) {
      for (const role of ROLE_NAMES) {
        for (const property of [...Object.keys(SHARED_ROLE_PROPERTIES), ...JUNK_NAMES]) {
          const schema = SHARED_ROLE_PROPERTIES[property] ?? { type: 'string' }
          for (const value of [admittedValue(schema), wrongTypeValue(schema)]) {
            const args = { source: SOURCE, options: { style: { roles: { [role]: { [property]: value } } } } }
            const rows = agreement(toolIndex, args)
            expectAgreement(rows, args)
            if (rows[0]!.canonical) admitted++
            else refused++
          }
        }
      }
    }
    expect(admitted).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(admitted)
  })

  test('accept and reject mutated argument records identically to the canonical schema', () => {
    fc.assert(fc.property(caseArb, ([toolIndex, args, mutations]) => {
      const value = mutate(args, mutations)
      expectAgreement(agreement(toolIndex, value), value)
    }), fcParameters({ numRuns: NUM_RUNS, examples: [[EMPTIED_ROOT_CASE]] }))
  })

  test('the mutation generator reaches both accepted and rejected records', () => {
    const outcomes = fc.sample(caseArb, { numRuns: 500 })
      .map(([toolIndex, args, mutations]) => agreement(toolIndex, mutate(args, mutations))[0]!.canonical)
    const accepted = outcomes.filter(Boolean).length
    expect(accepted).toBeGreaterThan(outcomes.length / 5)
    expect(outcomes.length - accepted).toBeGreaterThan(outcomes.length / 5)
  })
})
