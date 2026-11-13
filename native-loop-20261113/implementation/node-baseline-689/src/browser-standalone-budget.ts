// One synchronous physical budget includes decoder initialization, dictionary
// decoding, checksums and the payload copy. Clock checks are cooperative: they
// cannot preempt native calls or deliver browser events while JavaScript runs.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_WINDOW_BITS = 22
const MAX_LOOP_BODIES = 32_000_000
const DEADLINE_MS = 30_000

interface CodecBudget {
  remaining: number
  deadline: number
  cancelled?: () => boolean
  failure?: Error
}

let active: CodecBudget | undefined

function reject(budget: CodecBudget, error: Error): never {
  budget.failure ??= error
  throw budget.failure
}

function check(budget: CodecBudget): void {
  if (budget.failure) throw budget.failure
  if (budget.cancelled?.()) reject(budget, new Error('Background renderer loading was cancelled'))
  if (performance.now() >= budget.deadline) reject(budget, new Error('Background renderer load exceeded 30 seconds'))
}

function current(): CodecBudget {
  if (!active) throw new Error('Background renderer codec requires an active budget')
  return active
}

export function chargeCodecLoop(): void {
  const budget = current()
  if (--budget.remaining < 0) reject(budget, new Error('Background renderer codec exceeded 32000000 loop bodies'))
  if ((budget.remaining & 1023) === 0) check(budget)
}

export function limitCodecOutput(bytes: number): number {
  const budget = current()
  check(budget)
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_OUTPUT_BYTES) {
    reject(budget, new Error('Background renderer codec exceeds the 8 MiB output limit'))
  }
  return bytes
}

export function limitCodecWindow(bits: number): void {
  const budget = current()
  check(budget)
  if (!Number.isInteger(bits) || bits < 10 || bits > MAX_WINDOW_BITS) {
    reject(budget, new Error('Background renderer codec exceeds the 22-bit window limit'))
  }
}

function runSynchronously<T>(budget: CodecBudget, run: () => T): T {
  check(budget)
  const result = run()
  if (result !== null && (typeof result === 'object' || typeof result === 'function')
    && typeof (result as { then?: unknown }).then === 'function') {
    reject(budget, new TypeError('Background renderer codec work must be synchronous'))
  }
  check(budget)
  return result
}

export function withCodecBudget<T>(run: () => T, cancelled?: () => boolean): T {
  if (active) {
    const budget = active, previous = budget.cancelled
    if (cancelled) budget.cancelled = () => Boolean(previous?.() || cancelled())
    try { return runSynchronously(budget, run) }
    finally { budget.cancelled = previous }
  }
  const budget: CodecBudget = { remaining: MAX_LOOP_BODIES, deadline: performance.now() + DEADLINE_MS, cancelled }
  active = budget
  try {
    return runSynchronously(budget, run)
  } finally {
    active = undefined
  }
}
