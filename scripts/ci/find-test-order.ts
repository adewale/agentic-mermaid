import { randomInt } from 'node:crypto'
import { unitTestFiles } from './unit-test-files.ts'

// Finder only: each process logs its seed and exact file list for replay.
// Fresh OS processes cover module/native state that --isolate cannot reset.
const [mode, ...selected] = process.argv.slice(2)
if (mode !== 'shuffled' && mode !== 'fresh-process') throw new Error('Usage: bun run scripts/ci/find-test-order.ts shuffled|fresh-process [files...]')
const seed = process.env.AM_TEST_ORDER_SEED === undefined ? randomInt(0, 0x100000000) : Number(process.env.AM_TEST_ORDER_SEED)
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('AM_TEST_ORDER_SEED must be an unsigned 32-bit integer')
const files = selected.length ? selected : unitTestFiles()
// Shuffle file arguments explicitly; Bun also randomizes tests within files.
let state = seed
for (let index = files.length - 1; index > 0; index--) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  const swap = state % (index + 1)
  const previous = files[index]!
  files[index] = files[swap]!
  files[swap] = previous
}
console.log(JSON.stringify({ mode, seed, files }))
const failures: string[][] = []
for (const batch of mode === 'shuffled' ? [files] : files.map(file => [file])) {
  console.log(`Finder start: ${batch.join(' ')}`)
  const proc = Bun.spawn([process.execPath, 'test', '--timeout', '120000', '--randomize', '--seed', String(seed), ...batch], {
    stdout: 'inherit', stderr: 'inherit', timeout: mode === 'shuffled' ? 40 * 60_000 : 180_000,
  })
  if (await proc.exited !== 0) failures.push(batch)
}
console.log(JSON.stringify({ mode, seed, failedBatches: failures }))
process.exit(failures.length ? 1 : 0)
