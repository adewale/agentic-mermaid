// `bench` is the normal local suite; focused commands remain available.
import { spawnSync } from 'node:child_process'
import { ROOT } from './revision-tree.ts'

if (process.argv.includes('--help')) {
  console.log('bun run bench [--out DIR] [--rounds N] [--case ID,...] [--executable CHROMIUM]\nRuns samples, then the full Dave-style packed-artifact browser comparison. Use bench:samples for offline samples only; bench:dave for the browser comparison; bench:micro and bench:peers for focused diagnostics.')
  process.exit(0)
}

for (const script of ['eval/benchmark/sample-bench.ts', 'eval/benchmark/dave-bench.ts']) {
  const child = spawnSync(process.execPath, ['run', script, ...(script.endsWith('dave-bench.ts') ? process.argv.slice(2) : [])], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (child.status !== 0) process.exit(child.status ?? 1)
}
