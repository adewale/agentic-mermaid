import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveWranglerVersionUpload } from '../../scripts/ci/resolve-wrangler-version-upload'

const WORKER = 'agentic-mermaid-website'
const VERSION_ID = '556b9e5c-895c-4b19-958b-964a90322a1d'
const REPO = join(import.meta.dir, '..', '..')
const PARSER = join(REPO, 'scripts', 'ci', 'resolve-wrangler-version-upload.ts')
const DEPLOY_WORKFLOW = parseYaml(readFileSync(join(REPO, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')) as {
  jobs: Record<string, { steps?: Array<{ run?: string; 'working-directory'?: string }> }>
}

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

  test('the production workflow delegates candidate resolution to the tested parser', () => {
    const steps = Object.values(DEPLOY_WORKFLOW.jobs).flatMap(job => job.steps ?? [])
    const invocations = steps.flatMap(step => [...(step.run ?? '').matchAll(/\bbun run (\S*resolve-wrangler-version-upload\.ts)\b/g)]
      .map(match => resolve(REPO, step['working-directory'] ?? '.', match[1]!)))
    expect(invocations).toEqual([PARSER])
  })
})
