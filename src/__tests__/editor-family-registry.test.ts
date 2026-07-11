import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { EDITOR_SUPPORTED_FAMILY_LIST, EDITOR_SUPPORTED_HEADER_TOKENS } from '../editor-family-data.ts'

const HELPERS = readFileSync(join(import.meta.dir, '..', '..', 'editor/js/helpers.js'), 'utf8')

describe('editor family diagnostics are registry-derived', () => {
  test('supported header tokens exactly match built-in family metadata', () => {
    const expected = BUILTIN_FAMILY_METADATA.flatMap(family => family.headers).map(header => header.toLowerCase())
    expect(EDITOR_SUPPORTED_HEADER_TOKENS).toEqual(expected)
    for (const family of BUILTIN_FAMILY_METADATA) {
      for (const header of family.headers) expect(EDITOR_SUPPORTED_FAMILY_LIST).toContain(header)
    }
  })

  test('no supported family is classified by the editor as unsupported', () => {
    const block = HELPERS.match(/var UNSUPPORTED_MERMAID_HEADERS = \{([\s\S]*?)\n\};/)?.[1] ?? ''
    const unsupported = new Set([...block.matchAll(/^\s*['"]?([a-z][a-z0-9-]*)['"]?\s*:/gmi)].map(match => match[1]!.toLowerCase()))
    for (const header of EDITOR_SUPPORTED_HEADER_TOKENS) expect(unsupported.has(header), header).toBe(false)
    expect(HELPERS).toContain('if (SUPPORTED_FAMILY_HEADERS.indexOf(token) !== -1) return null;')
  })
})
