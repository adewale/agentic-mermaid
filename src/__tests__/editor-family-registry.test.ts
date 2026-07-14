import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { EDITOR_SUPPORTED_FAMILY_LIST } from '../editor-family-data.ts'

const HELPERS = readFileSync(join(import.meta.dir, '..', '..', 'editor/js/helpers.js'), 'utf8')

describe('editor family diagnostics are registry-derived', () => {
  test('supported-family copy exactly covers built-in family metadata', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      for (const header of family.headers) expect(EDITOR_SUPPORTED_FAMILY_LIST).toContain(header)
    }
  })

  test('consumes structured registry diagnostics without a shadow family roster', () => {
    expect(HELPERS).not.toContain('UNSUPPORTED_MERMAID_HEADERS')
    expect(HELPERS).not.toContain('SUPPORTED_FAMILY_HEADERS')
    expect(HELPERS).toContain('Unsupported Mermaid family')
    expect(HELPERS).toContain('is (?:unsupported|inventory-only) in Agentic Mermaid')
  })
})
