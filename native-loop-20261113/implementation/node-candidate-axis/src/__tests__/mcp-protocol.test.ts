import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
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
    }), fcParameters({ numRuns: 300 }))
  })

  test('property: direct batch item ids are restored independently', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.oneof(unsafeInteger, nonCanonicalNumber), { minLength: 1, maxLength: 8 }), tokens => {
      const raw = `[${tokens.map(token => `{"jsonrpc":"2.0","id":${token},"method":"ping"}`).join(',')}]`
      const protectedRequest = preserveExactJsonRpcIds(raw)
      const requests = JSON.parse(protectedRequest.body) as Array<{ id: string }>
      const output = stringifyJsonRpc(requests.map(request => ({ jsonrpc: '2.0', id: request.id, result: {} })), protectedRequest.ids)
      for (const token of tokens) expect(output).toContain(`"id":${token}`)
    }), fcParameters({ numRuns: 100 }))
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

  test('fractional ids remain numeric so MCP admission can reject them', () => {
    for (const token of ['1.5', '-0.25', '1.255e2', '1e-1']) {
      const raw = `{"jsonrpc":"2.0","id":${token},"method":"ping"}`
      expect(preserveExactJsonRpcIds(raw)).toEqual({ body: raw, ids: [] })
    }
  })

  // Putting each raw token back in place of its quoted sentinel restores the
  // transport text exactly: protection changes nothing else.
  const restore = (body: string, ids: readonly { sentinel: string; raw: string }[]) =>
    ids.reduce((text, id) => text.replace(JSON.stringify(id.sentinel), id.raw), body)

  test('property: protection of any transport text is lossless', () => {
    const jsonish = fc.array(fc.oneof(fc.constantFrom('{', '}', '[', ']', '"id"', ':', ',', ' ', '"', '\\', '9007199254740993', '-0', '1e400', '12'), fc.string({ unit: 'binary', maxLength: 4 })), { maxLength: 24 }).map(parts => parts.join(''))
    fc.assert(fc.property(fc.oneof(fc.string({ unit: 'binary' }), jsonish), raw => {
      const { body, ids } = preserveExactJsonRpcIds(raw)
      expect(restore(body, ids)).toBe(raw)
    }), fcParameters({ numRuns: 500 }))
  })

  test('property: a request id is protected exactly when JSON cannot round-trip it', () => {
    const integerToken = fc.tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 30n })).map(([negative, value]) => `${negative ? '-' : ''}${value}`)
    fc.assert(fc.property(integerToken, token => {
      const raw = `{"jsonrpc":"2.0","id":${token},"method":"ping"}`
      const { body, ids } = preserveExactJsonRpcIds(raw)
      const exact = JSON.stringify(JSON.parse(token)) === token
      expect(ids.length).toBe(exact ? 0 : 1)
      expect(JSON.parse(body).id).toBe(exact ? JSON.parse(token) : ids[0]!.sentinel)
      expect(restore(body, ids)).toBe(raw)
    }), fcParameters({ numRuns: 500, examples: [['9007199254740993'], ['-0'], ['9007199254740991']] }))
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
