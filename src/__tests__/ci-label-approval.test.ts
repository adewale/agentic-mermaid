import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()
const root = join(import.meta.dir, '../..')

test.each([
  ['fresh', 0],
  ['missing-created-at', 1],
  ['bad-created-at', 1],
  ['http-error', 1],
] as const)('head-specific approval CLI: %s', (scenario, status) => {
  // Both relevant labels and label events occur on page two. The real CLI
  // must consume them and the run timestamp before deciding on this head.
  const mock = temp.file('fetch.ts', `
    let calls = 0
    globalThis.fetch = async input => {
      calls++
      const url = new URL(String(input)), page = Number(url.searchParams.get('page'))
      if (process.env.LABEL_TEST_SCENARIO === 'http-error') return new Response('private-server-body', { status: 401 })
      let value
      if (url.pathname.endsWith('/labels')) value = page === 1 ? Array.from({length:100}, (_,i)=>({name:'other-'+i})) : [{name:'payload-growth-approved'}]
      else if (url.pathname.endsWith('/events')) value = page === 1 ? Array.from({length:100}, ()=>({event:'commented'})) : [{event:'labeled',label:{name:'payload-growth-approved'},actor:{login:'reviewer'},created_at:'2026-10-27T09:01:00Z'}]
      else if (url.pathname.endsWith('/actions/runs/42')) value = process.env.LABEL_TEST_SCENARIO === 'missing-created-at' ? {} : {created_at:process.env.LABEL_TEST_SCENARIO === 'bad-created-at' ? 'not-a-date' : '2026-10-27T09:00:00Z'}
      else throw Error('Unexpected approval endpoint')
      return new Response(JSON.stringify(value))
    }
    process.on('exit',()=>console.error('API_CALLS='+calls))
  `)
  const result = spawnSync(process.execPath, ['--preload', mock, join(root, 'scripts/ci/label-approval.ts'), 'check', '--label', 'payload-growth-approved'], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, GH_TOKEN: 'private-test-token', GITHUB_TOKEN: '', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '42', PR_NUMBER: '7', EVENT_ACTION: 'synchronize', LABEL_TEST_SCENARIO: scenario },
  })
  expect(result.status, result.stdout + result.stderr).toBe(status)
  expect(result.stdout + result.stderr).not.toContain('private-test-token')
  expect(result.stdout + result.stderr).not.toContain('private-server-body')
  if (scenario === 'fresh') {
    expect(result.stdout).toContain('applied by reviewer')
    expect(result.stderr).toContain('API_CALLS=5')
  }
})
