import { expect, test } from 'bun:test'
import { PassThrough, Readable, Writable } from 'node:stream'
import { streamJsonlBatch } from '../cli/jsonl.ts'

test('a blocked output stops processing requests and preserves handler failures', async () => {
  let handled = 0
  let release: (() => void) | undefined
  let firstWrite: () => void
  const wrote = new Promise<void>(resolve => { firstWrite = resolve })
  const chunks: string[] = []
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      chunks.push(chunk.toString())
      if (chunks.length === 1) { release = done; firstWrite() }
      else done()
    },
  })
  const input = Readable.from(Array.from({ length: 1000 }, (_, i) => `${i}\n`))
  const finished = streamJsonlBatch(input, output, (line, index) => {
    handled++
    if (index === 1) throw new Error('one request failed')
    return { index, line }
  })
  try {
    // The consumer deliberately withholds its first write acknowledgement.
    await wrote
    await new Promise(resolve => setImmediate(resolve))
    expect(chunks).toHaveLength(1)
    expect(handled).toBeLessThanOrEqual(2)
  } finally { release?.() }
  await finished
  expect(handled).toBe(1000)
  const rows = chunks.join('').trim().split('\n').map(line => JSON.parse(line))
  expect(rows[0]).toEqual({ index: 0, line: '0' })
  expect(rows[1]).toEqual({ ok: false, error: { code: 'BATCH_HANDLER_ERROR', message: 'one request failed' } })
  expect(rows[999]).toEqual({ index: 999, line: '999' })
  expect(output.writableEnded).toBe(false)
})

test('input failure rejects instead of reporting an empty successful batch', async () => {
  const input = new PassThrough()
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  const finished = streamJsonlBatch(input, output, line => ({ line }))
  input.destroy(new Error('input failed'))
  await expect(finished).rejects.toThrow('input failed')
})

test('output failure rejects while the producer remains open', async () => {
  const input = new PassThrough()
  const output = new Writable({ write(_chunk, _encoding, done) { done(new Error('output failed')) } })
  const finished = streamJsonlBatch(input, output, line => ({ line }))
  input.write('first\n')
  try { await expect(finished).rejects.toThrow('output failed') } finally { input.destroy() }
  expect(input.destroyed).toBe(true)
})

test('EOF waits for the final output acknowledgement and propagates a late failure', async () => {
  let release: (error?: Error | null) => void
  let firstWrite: () => void
  const wrote = new Promise<void>(resolve => { firstWrite = resolve })
  const output = new Writable({ write(_chunk, _encoding, done) { release = done; firstWrite() } })
  const input = Readable.from(['last\n'])
  let settled = false
  const result = streamJsonlBatch(input, output, line => ({ line })).then(
    () => { settled = true; return 'success' },
    error => { settled = true; return error.message },
  )
  await wrote
  await new Promise(resolve => setImmediate(resolve))
  const settledBeforeAcknowledgement = settled
  release!(new Error('final write failed'))
  expect(settledBeforeAcknowledgement).toBe(false)
  expect(await result).toBe('final write failed')
})

test('repeated batches retain no output listeners and leave shared stdout open', async () => {
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  const before = { errors: output.listenerCount('error'), closes: output.listenerCount('close') }
  for (let i = 0; i < 20; i++) await streamJsonlBatch(Readable.from(['one\n']), output, line => ({ line }))
  expect(output.listenerCount('error')).toBe(before.errors)
  expect(output.listenerCount('close')).toBe(before.closes)
  expect(output.writableEnded).toBe(false)
  expect(output.destroyed).toBe(false)
})

test('premature output close rejects and cancels the open input', async () => {
  const input = new PassThrough()
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  const finished = streamJsonlBatch(input, output, line => ({ line }))
  input.write('first\n')
  output.destroy()
  await expect(finished).rejects.toThrow('output closed before batch completed')
  expect(input.destroyed).toBe(true)
})
