// One in-process CLI capture for tests that call runCli directly: stdout and
// stderr are collected (strings or bytes) and always restored, even on throw.

export interface CapturedCli {
  code: number
  out: string
  err: string
}

function intercept(): { result: (code: number) => CapturedCli; restore: () => void } {
  const out: string[] = []
  const err: string[] = []
  const decoder = new TextDecoder()
  const text = (chunk: unknown) => (chunk instanceof Uint8Array ? decoder.decode(chunk) : String(chunk))
  const originalOut = process.stdout.write
  const originalErr = process.stderr.write
  process.stdout.write = ((chunk: unknown) => { out.push(text(chunk)); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => { err.push(text(chunk)); return true }) as typeof process.stderr.write
  return {
    result: code => ({ code, out: out.join(''), err: err.join('') }),
    restore: () => {
      process.stdout.write = originalOut
      process.stderr.write = originalErr
    },
  }
}

export function captureCli(run: () => number): CapturedCli {
  const capture = intercept()
  try {
    return capture.result(run())
  } finally {
    capture.restore()
  }
}

/** The same capture around an async entry point (e.g. runAmCli). */
export async function captureCliAsync(run: () => Promise<number>): Promise<CapturedCli> {
  const capture = intercept()
  try {
    return capture.result(await run())
  } finally {
    capture.restore()
  }
}
