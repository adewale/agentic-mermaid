import { expect, test } from 'bun:test'
import { observe, type ObservationInput } from './worker.ts'

// These are rejected requests, not measurements: the root cannot be imported.
const base = { root: '/no-font-layout-artifact', mode: 'quality', out: '/unused', repetitions: 0,
  item: { id: 'retired-request', source: 'flowchart TD\nA-->B', family: 'flowchart' } }

test.each([
  { backend: 'agentic', features: [], message: 'Native (agentic) has been retired' },
  { backend: 'elk', features: ['ports'], message: 'The Native ports feature has been retired' },
])('font capture rejects retired request $backend/$features before importing the artifact', async request => {
  const input: ObservationInput = JSON.parse(JSON.stringify({ ...base, backend: request.backend, features: request.features }))
  await expect(observe(input)).rejects.toThrow(request.message)
  for (const [file, args] of [['worker.ts', []], ['png-worker.ts', []], ['warm-memory.ts', ['--child']]] as const) {
    const child = Bun.spawnSync([process.execPath, new URL(file, import.meta.url).pathname, ...args], {
      stdin: new TextEncoder().encode(JSON.stringify(input)), timeout: 10_000,
    })
    expect(child.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(child.stderr)).toContain(request.message)
    expect(child.stdout.length).toBe(0)
  }
})
