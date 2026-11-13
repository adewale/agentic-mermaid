import { describe, expect, test } from 'bun:test'
import {
  JSON_CONFIG_ADMISSION_LIMITS,
  validateJsonConfigAdmission,
} from '../shared/json-config-admission.ts'

describe('shared JSON/config admission budget', () => {
  test('accepts normal recursive Mermaid configuration', () => {
    expect(validateJsonConfigAdmission({
      theme: 'base',
      flowchart: { wrappingWidth: 160 },
      extensionData: [null, true, 4, 'value', { nested: ['ok'] }],
    })).toEqual([])
  })

  test('iteratively rejects excessive depth, nodes, and container items', () => {
    let deep: unknown = true
    for (let index = 0; index < JSON_CONFIG_ADMISSION_LIMITS.maxDepth + 2; index++) deep = { a: deep }
    expect(validateJsonConfigAdmission(deep)).toContainEqual(expect.objectContaining({
      code: 'JSON_DEPTH_LIMIT',
      message: `exceeds maximum nesting depth ${JSON_CONFIG_ADMISSION_LIMITS.maxDepth}`,
    }))

    const tooManyItems = Array(JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer + 1).fill(null)
    expect(validateJsonConfigAdmission(tooManyItems)).toContainEqual(expect.objectContaining({
      code: 'JSON_ITEM_LIMIT',
    }))

    const manyNodes: Record<string, unknown> = {}
    const repeated = Array(
      Math.floor(JSON_CONFIG_ADMISSION_LIMITS.maxNodes / JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer),
    ).fill(true)
    for (let index = 0; index < JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer; index++) {
      manyNodes[`k${index}`] = repeated
    }
    expect(validateJsonConfigAdmission(manyNodes)).toContainEqual(expect.objectContaining({
      code: 'JSON_NODE_LIMIT',
    }))
  })

  test('bounds aggregate text by characters and UTF-8 bytes', () => {
    expect(validateJsonConfigAdmission({
      value: 'a'.repeat(JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters + 1),
    })).toContainEqual(expect.objectContaining({ code: 'JSON_TEXT_CHARACTER_LIMIT' }))

    const threeByteCharacters = Math.floor(JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextBytes / 3) + 1
    expect(threeByteCharacters).toBeLessThan(JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters)
    expect(validateJsonConfigAdmission({ value: '€'.repeat(threeByteCharacters) }))
      .toContainEqual(expect.objectContaining({ code: 'JSON_TEXT_BYTE_LIMIT' }))
  })

  test('caps diagnostics and rejects cycles, sparse arrays, and prototype keys', () => {
    const invalid = Object.fromEntries(
      Array.from({ length: JSON_CONFIG_ADMISSION_LIMITS.maxDiagnostics + 20 }, (_, index) =>
        [`bad${index}`, () => index]),
    )
    const diagnostics = validateJsonConfigAdmission(invalid)
    expect(diagnostics).toHaveLength(JSON_CONFIG_ADMISSION_LIMITS.maxDiagnostics)
    expect(diagnostics.at(-1)?.code).toBe('JSON_DIAGNOSTIC_LIMIT')

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(validateJsonConfigAdmission(cyclic)).toContainEqual(expect.objectContaining({
      code: 'JSON_CYCLE', path: ['self'],
    }))

    const sparse = Array(2)
    sparse[1] = true
    expect(validateJsonConfigAdmission(sparse)).toContainEqual(expect.objectContaining({
      code: 'JSON_SPARSE_ARRAY', path: [0],
    }))

    const hostile = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(validateJsonConfigAdmission(hostile)).toContainEqual(expect.objectContaining({
      code: 'JSON_PROTOTYPE_KEY', path: ['__proto__'],
    }))
  })
})
