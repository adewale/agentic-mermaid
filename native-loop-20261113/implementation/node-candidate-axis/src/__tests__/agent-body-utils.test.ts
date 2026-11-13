import { describe, expect, test } from 'bun:test'
import { indexedIdAllocator, labelOverflowCollector } from '../agent/body-utils.ts'
import type { LayoutWarning } from '../agent/types.ts'

describe('agent body utilities', () => {
  test('indexed ids allocate the lowest free value and reserve each result', () => {
    const next = indexedIdAllocator(['item-0', 'item-2', 'other-1'], 'item')
    expect([next(), next(), next()]).toEqual(['item-1', 'item-3', 'item-4'])
  })

  test('label collection preserves the shared warning shape and caller cap', () => {
    const warnings: LayoutWarning[] = []
    const overflow = labelOverflowCollector(warnings, { labelCharCap: 3 })
    overflow('short', 'abc')
    overflow('long', 'abcd')
    expect(warnings).toEqual([{ code: 'LABEL_OVERFLOW', target: 'long', charCount: 4, limit: 3 }])
  })
})
