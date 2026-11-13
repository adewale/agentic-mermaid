import type { JsonSchema } from '../shared/schema-validation.ts'
import { styleOptionValidationRoot } from './style-registry.ts'
export { STYLE_OPTION_SCHEMA } from '../render-style-option-reference.ts'

// Main's canonical reference fragments stay shared; only their full StyleSpec
// definitions need the already-demanded style implementation.
export function renderOptionSchemaRoot(field: string, root: JsonSchema): JsonSchema {
  return field === 'style' ? styleOptionValidationRoot() : root
}
export function styleSchemaDefinitions(): Readonly<Record<string, JsonSchema>> { return styleOptionValidationRoot().$defs }
