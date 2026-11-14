import { styleSpecJsonSchema } from './scene/style-spec.ts'
import { deepFreeze } from './shared/plain-data.ts'
import type { JsonSchema } from './shared/schema-validation.ts'
export { STYLE_OPTION_SCHEMA } from './render-style-option-reference.ts'
type JsonSchemaNode = JsonSchema

/**
 * The StyleSpec record and the role-style records it references, as local
 * definitions. A style input names the record by `$ref` instead of carrying
 * it: a name-or-record input and a stack of them would otherwise inline the
 * same ~22 KB record twice in every schema that accepts `style`. The record's
 * own `#/$defs/roleStyle-*` references keep their names, so every schema that
 * places these definitions at its root resolves them unchanged.
 */
const STYLE_SCHEMA_DEFINITIONS: Readonly<Record<string, JsonSchemaNode>> = (() => {
  const { $schema: _dialect, $id: _id, title: _title, $defs, ...record } = styleSpecJsonSchema() as Record<string, unknown>
  const definitions = { ...($defs as Record<string, JsonSchemaNode>), styleSpec: record as JsonSchemaNode }
  if (Object.hasOwn($defs as object, 'styleSpec') || Object.hasOwn($defs as object, 'jsonValue')) {
    throw new Error('StyleSpec schema definitions collide with render option definitions')
  }
  return definitions
})()


export function styleSchemaDefinitions(): Readonly<Record<string, JsonSchemaNode>> { return STYLE_SCHEMA_DEFINITIONS }
export const STYLE_OPTION_VALIDATION_ROOT = deepFreeze({ $defs: STYLE_SCHEMA_DEFINITIONS })
export function renderOptionSchemaRoot(field: string, root: JsonSchemaNode): JsonSchemaNode { return field === 'style' ? STYLE_OPTION_VALIDATION_ROOT : root }
