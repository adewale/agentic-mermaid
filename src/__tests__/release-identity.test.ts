import { describe, expect, test } from 'bun:test'
import { validateReleaseIdentity, type ReleaseIdentity } from '../../scripts/ci/release-identity.ts'

const valid: ReleaseIdentity = {
  tag: 'v1.2.3',
  packageVersion: '1.2.3',
  sourceVersion: '1.2.3',
  serverVersion: '1.2.3',
  packageServerVersion: '1.2.3',
  head: 'abc123',
  tagCommit: 'abc123',
  mainContainsHead: true,
}

describe('release identity gate', () => {
  test('accepts one version and commit authority', () => {
    expect(() => validateReleaseIdentity(valid)).not.toThrow()
  })

  test.each([
    ['tag', { tag: 'v1.2.2' }, /tag .* package version/i],
    ['source', { sourceVersion: '1.2.2' }, /src\/version\.ts version/i],
    ['server', { serverVersion: '1.2.2' }, /server\.json version/i],
    ['package projection', { packageServerVersion: '1.2.2' }, /server\.json package version/i],
    ['commit', { tagCommit: 'def456' }, /not checked-out HEAD/i],
    ['main ancestry', { mainContainsHead: false }, /not contained in origin\/main/i],
  ] as const)('rejects mismatched %s identity', (_name, patch, message) => {
    expect(() => validateReleaseIdentity({ ...valid, ...patch })).toThrow(message)
  })
})
