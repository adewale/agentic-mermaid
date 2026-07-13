import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { isJsonContentType, preserveExactJsonRpcIds, stringifyJsonRpc } from '../mcp/protocol.ts'

const unsafeInteger = fc.oneof(
  fc.bigInt({ min: BigInt(Number.MAX_SAFE_INTEGER) + 1n, max: (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000n }),
  fc.bigInt({ min: (BigInt(Number.MIN_SAFE_INTEGER) - 1n) * 1_000_000n, max: BigInt(Number.MIN_SAFE_INTEGER) - 1n }),
).map(value => value.toString())

const nonCanonicalNumber = fc.oneof(
  fc.constant('-0'),
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(value => `${value}.0`),
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(value => `${value}e0`),
  fc.integer({ min: 1, max: 999_999 }).map(value => `${value / 10}e1`),
)

describe('exact JSON-RPC numeric id codec', () => {
  test('property: every unsafe/non-canonical numeric token round-trips lexically', () => {
    fc.assert(fc.property(fc.oneof(unsafeInteger, nonCanonicalNumber), token => {
      const raw = `{"jsonrpc":"2.0","id":${token},"method":"ping","params":{"id":9007199254740995}}`
      const protectedRequest = preserveExactJsonRpcIds(raw)
      expect(protectedRequest.ids.map(id => id.raw)).toEqual([token])
      const request = JSON.parse(protectedRequest.body)
      const output = stringifyJsonRpc({ jsonrpc: '2.0', id: request.id, result: { id: request.params.id } }, protectedRequest.ids)
      expect(output).toContain(`"id":${token}`)
      expect(output).toContain('"result":{"id":9007199254740996}')
    }), { numRuns: 300 })
  })

  test('property: direct batch item ids are restored independently', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.oneof(unsafeInteger, nonCanonicalNumber), { minLength: 1, maxLength: 8 }), tokens => {
      const raw = `[${tokens.map(token => `{"jsonrpc":"2.0","id":${token},"method":"ping"}`).join(',')}]`
      const protectedRequest = preserveExactJsonRpcIds(raw)
      const requests = JSON.parse(protectedRequest.body) as Array<{ id: string }>
      const output = stringifyJsonRpc(requests.map(request => ({ jsonrpc: '2.0', id: request.id, result: {} })), protectedRequest.ids)
      for (const token of tokens) expect(output).toContain(`"id":${token}`)
    }), { numRuns: 100 })
  })

  test('safe integer ids stay numeric and sentinel-shaped result strings are untouched', () => {
    const raw = '{"jsonrpc":"2.0","id":42,"method":"ping"}'
    expect(preserveExactJsonRpcIds(raw)).toEqual({ body: raw, ids: [] })

    const unsafe = preserveExactJsonRpcIds('{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}')
    const sentinel = unsafe.ids[0]!.sentinel
    const output = stringifyJsonRpc({ jsonrpc: '2.0', id: sentinel, result: { value: sentinel } }, unsafe.ids)
    expect(output).toContain('"id":9007199254740993')
    expect(output).toContain(`"value":${JSON.stringify(sentinel)}`)
  })

  test('property: malformed transport text never crashes the protector', () => {
    fc.assert(fc.property(fc.string(), raw => {
      expect(() => preserveExactJsonRpcIds(raw)).not.toThrow()
    }), { numRuns: 500 })
  })
})

describe('JSON HTTP media type', () => {
  test('accepts application/json parameters but rejects prefix and malformed lookalikes', () => {
    for (const value of ['application/json', 'Application/JSON; charset=utf-8', 'application/json; profile="mcp v1"']) {
      expect(isJsonContentType(value)).toBe(true)
    }
    for (const value of ['', 'application/jsonp', 'application/json-patch+json', 'application/json garbage', 'application/json; charset']) {
      expect(isJsonContentType(value)).toBe(false)
    }
  })
})
