import { describe, expect, it } from 'bun:test'
import { lazySizes, payloadDelta, SHARED_CORE_PAYLOAD, STANDALONE_EDITOR_PAYLOAD, type PayloadSizes } from '../../scripts/ci/payload-delta.ts'

// The per-PR growth gate is where payload growth is decided (the absolute
// ceilings only bound drift), so its pass/fail rule is a CI contract.
const size = (gzip: number) => ({ requests: 1, raw: gzip * 3, gzip })

describe('per-PR payload growth gate', () => {
  it.each([
    ['family over 2% and 1 KiB', 'lazy:pie', 50_000, 51_500, true],
    ['family over 1 KiB but under 2%', 'lazy:pie', 200_000, 201_500, false],
    ['family over 2% but under 1 KiB', 'lazy:pie', 10_000, 10_900, false],
    ['shared core over 1 KiB, under 2%', SHARED_CORE_PAYLOAD, 155_000, 156_500, true],
    ['shared core under 1 KiB', SHARED_CORE_PAYLOAD, 155_000, 155_900, false],
    ['shared core the base never measured', SHARED_CORE_PAYLOAD, undefined, 155_000, false],
    ['new route', 'route:new', undefined, 5_000, true],
    ['standalone editor under 2%', STANDALONE_EDITOR_PAYLOAD, 1_570_000, 1_590_000, false],
    ['standalone editor the base never measured', STANDALONE_EDITOR_PAYLOAD, undefined, 1_570_000, false],
  ] as const)('%s', (_label, name, before, after, exceeds) => {
    const base: PayloadSizes = before === undefined ? {} : { [name]: size(before) }
    const [row] = payloadDelta(base, { [name]: size(after) })
    expect(row).toMatchObject({ name, gzipDelta: after - (before ?? 0), exceeds })
  })

  it('reads the shared core from a lazy report', () => {
    const sizes = lazySizes({ initial: size(6_000), sharedCore: size(155_000), families: { pie: size(220_000) } })
    expect(sizes[SHARED_CORE_PAYLOAD]).toEqual(size(155_000))
    expect(Object.keys(sizes).sort()).toEqual(['lazy:initial', 'lazy:pie', SHARED_CORE_PAYLOAD])
  })
})
