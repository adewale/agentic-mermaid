// Opt-in slim tool profile (`agentic-mermaid-mcp --tool-profile slim`).
// tools/list loads every advertised schema into the agent's context. The slim
// profile advertises each render tool's arguments one level deep (the tool's
// own fields and each `options` field, with their types, enums, bounds and
// descriptions) and no $defs, and replaces execute's inline SDK declaration
// with a pointer to describe_sdk capability=code-mode. Argument validation is
// unchanged: the side table maps each slim schema to the canonical one, so a
// slim schema only ever accepts more than the server does, never less.
import { isPlainRecord } from '../shared/plain-data.ts'
import { registerAdvertisedMcpInputSchema, mcpToolValidationSchema, type McpToolDefinition } from './tool-surface.ts'

export { isMcpToolProfile, MCP_TOOL_PROFILES, type McpToolProfile } from './tool-profile.ts'

type Schema = Record<string, unknown>

// Keywords a summarized schema keeps from the node itself. Each is an
// assertion the canonical schema makes at the same location, or an
// annotation, so keeping it cannot refuse a value the canonical schema admits.
const KEPT_ASSERTIONS = ['enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength'] as const
const KEPT_ANNOTATIONS = ['description', 'default'] as const
const JSON_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value
}

function resolve(node: unknown, definitions: Schema): unknown {
  let current = node
  for (let hops = 0; hops < 32 && isPlainRecord(current) && typeof current.$ref === 'string' && current.$ref.startsWith('#/$defs/'); hops++) {
    current = definitions[current.$ref.slice('#/$defs/'.length)]
  }
  return current
}

/** Every JSON type a value admitted by `node` can have, or undefined when any
 * type may be admitted. A superset is always safe; it only loosens. */
function admittedTypes(node: unknown, definitions: Schema, depth = 0): Set<string> | undefined {
  const schema = resolve(node, definitions)
  if (!isPlainRecord(schema) || depth > 32) return undefined
  if (typeof schema.type === 'string') return new Set(schema.type === 'number' ? ['number', 'integer'] : [schema.type])
  if (Array.isArray(schema.type)) return new Set(schema.type.flatMap(type => type === 'number' ? ['number', 'integer'] : [String(type)]))
  if (Array.isArray(schema.enum)) return new Set(schema.enum.map(jsonTypeOf).flatMap(type => type === 'integer' ? ['integer', 'number'] : [type]))
  if (Object.hasOwn(schema, 'const')) return new Set([jsonTypeOf(schema.const)].flatMap(type => type === 'integer' ? ['integer', 'number'] : [type]))
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined
  if (branches) {
    const union = new Set<string>()
    for (const branch of branches) {
      const types = admittedTypes(branch, definitions, depth + 1)
      if (!types) return undefined
      for (const type of types) union.add(type)
    }
    return union
  }
  // Each allOf member bounds the value on its own; the first one suffices.
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) return admittedTypes(schema.allOf[0], definitions, depth + 1)
  if (isPlainRecord(schema.properties) || Object.hasOwn(schema, 'additionalProperties')) return new Set(['object'])
  if (Object.hasOwn(schema, 'items')) return new Set(['array'])
  return undefined
}

/** The JSON Schema `type` value for a type set, folding integer into number. */
function typeKeyword(types: Set<string> | undefined): string | string[] | undefined {
  if (!types) return undefined
  const named = JSON_TYPES.filter(type => types.has(type) && !(type === 'integer' && types.has('number')))
  if (named.length === 0) return undefined
  return named.length === 1 ? named[0] : named
}

/** One schema position reduced to its own type, scalar assertions and annotations. */
function summarized(node: unknown, definitions: Schema): Schema {
  const schema = resolve(node, definitions)
  if (!isPlainRecord(schema)) return {}
  const projected: Schema = {}
  const type = typeKeyword(admittedTypes(schema, definitions))
  if (type !== undefined) projected.type = type
  for (const keyword of [...KEPT_ASSERTIONS, ...KEPT_ANNOTATIONS]) {
    if (Object.hasOwn(schema, keyword)) projected[keyword] = schema[keyword]
  }
  return projected
}

/** A closed object whose property names the slim schema keeps: the tool root
 * and its `options` object. Deeper records are summarized to their type. */
function expanded(schema: Schema, definitions: Schema, depth: number): Schema {
  const properties = schema.properties as Record<string, unknown>
  const projected: Schema = { type: 'object' }
  if (typeof schema.description === 'string') projected.description = schema.description
  if (schema.additionalProperties === false) projected.additionalProperties = false
  projected.properties = Object.fromEntries(Object.entries(properties).map(([name, child]) => {
    const resolved = resolve(child, definitions)
    return [name, depth < 1 && isPlainRecord(resolved) && isPlainRecord(resolved.properties) && !resolved.anyOf && !resolved.oneOf && !resolved.allOf
      ? expanded(resolved, definitions, depth + 1)
      : summarized(resolved, definitions)]
  }))
  if (Array.isArray(schema.required)) projected.required = schema.required
  return projected
}

/** The slim advertised form of a canonical tool input schema. */
export function slimMcpInputSchema(canonical: Schema): Schema {
  const definitions = isPlainRecord(canonical.$defs) ? canonical.$defs : {}
  return expanded(canonical, definitions, 0)
}

const SLIM_EXECUTE_DECLARATION = `The global mermaid SDK (parseRegisteredMermaid, as<Family> narrowers, mutate,
buildMermaid, verifyMermaid, serializeMermaid, renderMermaidSVG and the other render
and analysis calls) is declared by describe_sdk capability=code-mode; read it before
writing code. Family op schemas come from describe_sdk family=<id>.`

/** One tool in the slim profile. Tools whose schema carries no $defs are
 * already small and are returned unchanged. */
export function slimMcpTool(tool: McpToolDefinition, sdkDeclaration: string): McpToolDefinition {
  if (tool.name === 'execute') {
    if (!tool.description.endsWith(sdkDeclaration)) throw new Error('slim execute: the execute description does not end with its SDK declaration')
    return { ...tool, description: `${tool.description.slice(0, tool.description.length - sdkDeclaration.length)}${SLIM_EXECUTE_DECLARATION}` }
  }
  const canonical = mcpToolValidationSchema(tool)
  if (!isPlainRecord(canonical.$defs)) return tool
  const inputSchema = slimMcpInputSchema(canonical)
  registerAdvertisedMcpInputSchema(inputSchema, canonical)
  return { ...tool, inputSchema }
}
