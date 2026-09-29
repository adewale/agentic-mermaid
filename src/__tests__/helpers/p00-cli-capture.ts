// One in-process CLI capture for tests that call runCli directly: stdout and
// stderr are collected (strings or bytes) and always restored, even on throw.

export interface CapturedCli {
  code: number
  out: string
  err: string
}

export function captureCli(run: () => number): CapturedCli {
  const out: string[] = []
  const err: string[] = []
  const decoder = new TextDecoder()
  const text = (chunk: unknown) => (chunk instanceof Uint8Array ? decoder.decode(chunk) : String(chunk))
  const originalOut = process.stdout.write
  const originalErr = process.stderr.write
  process.stdout.write = ((chunk: unknown) => { out.push(text(chunk)); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => { err.push(text(chunk)); return true }) as typeof process.stderr.write
  try {
    const code = run()
    return { code, out: out.join(''), err: err.join('') }
  } finally {
    process.stdout.write = originalOut
    process.stderr.write = originalErr
  }
}
