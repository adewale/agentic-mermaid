import { type Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Retain at most the current input line, output envelope and stream buffers.
 * Pulling the next request waits for stdout capacity, including slow consumers. */
export async function streamJsonlBatch(input: Readable, output: Writable, handler: (line: string, index: number) => unknown): Promise<void> {
  input.setEncoding('utf8')
  async function* responses(source: AsyncIterable<string | Buffer>) {
    let pending = ''
    let index = 0
    const response = (line: string): string => {
      let value: unknown
      try {
        value = handler(line, index++)
      } catch (error) {
        value = { ok: false, error: { code: 'BATCH_HANDLER_ERROR', message: error instanceof Error ? error.message : String(error) } }
      }
      return JSON.stringify(value) + '\n'
    }
    for await (const chunk of source) {
      pending += chunk
      let start = 0
      let end: number
      while ((end = pending.indexOf('\n', start)) !== -1) {
        const line = pending.slice(start, end)
        start = end + 1
        if (line.trim() !== '') yield response(line)
      }
      pending = pending.slice(start)
    }
    if (pending.trim() !== '') yield response(pending)
  }
  // Finish an owned adapter so pipeline awaits the final write callback without
  // ending shared stdout. end:false can resolve before that acknowledgement.
  const writer = new Writable({ highWaterMark: 1, write(chunk, encoding, done) { output.write(chunk, encoding, done) } })
  const onError = (error: Error) => { writer.destroy(error) }
  const onClose = () => { writer.destroy(new Error('output closed before batch completed')) }
  output.on('error', onError)
  output.on('close', onClose)
  try {
    await pipeline(input, responses, writer)
  } finally {
    output.removeListener('error', onError)
    output.removeListener('close', onClose)
  }
}
