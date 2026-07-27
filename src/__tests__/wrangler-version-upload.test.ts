import { describe, expect, test } from 'bun:test'
import { resolveWranglerVersionUpload } from '../../scripts/ci/resolve-wrangler-version-upload'

const WORKER = 'agentic-mermaid-website'
const VERSION_ID = '556b9e5c-895c-4b19-958b-964a90322a1d'

describe('Wrangler version-upload output', () => {
  test('treats worker_tag as an opaque Cloudflare identifier', () => {
    const output = JSON.stringify({
      type: 'version-upload',
      version: 1,
      worker_name: WORKER,
      worker_tag: 'opaque-worker-tag-that-is-not-the-git-sha',
      version_id: VERSION_ID,
    })

    expect(resolveWranglerVersionUpload(output, WORKER)).toBe(VERSION_ID)
  })

  test('requires one unambiguous upload event for the expected worker', () => {
    const event = JSON.stringify({
      type: 'version-upload',
      version: 1,
      worker_name: WORKER,
      worker_tag: 'opaque-worker-tag',
      version_id: VERSION_ID,
    })

    expect(() => resolveWranglerVersionUpload('', WORKER)).toThrow('found 0')
    expect(() => resolveWranglerVersionUpload(`${event}\n${event}`, WORKER)).toThrow('found 2')
    expect(() => resolveWranglerVersionUpload(event, 'another-worker')).toThrow('found 0')
  })
})
