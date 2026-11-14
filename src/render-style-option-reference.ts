import type { JsonSchema } from './shared/schema-validation.ts'
type JsonSchemaNode = JsonSchema

export const STYLE_INPUT_SCHEMA = {
  anyOf: [
    { type: 'string', description: 'Registered Style or Palette name.' },
    { $ref: '#/$defs/styleSpec' },
  ],
  'x-agentic-mermaid-validation-expectation': 'a registered Style name or StyleSpec',
} as const satisfies JsonSchemaNode

export const STYLE_OPTION_SCHEMA = {
  anyOf: [
    STYLE_INPUT_SCHEMA,
    { type: 'array', items: STYLE_INPUT_SCHEMA, description: 'Style stack merged from left to right.' },
  ],
  description: 'A registered name, inline StyleSpec, or left-to-right stack of either.',
  'x-agentic-mermaid-runtime-validator': 'styleInput',
} as const satisfies JsonSchemaNode

