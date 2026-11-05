import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { SOURCE_TOOL_NODE_FLAGS } from './source-worker-limits.ts'

// One capped process performs rendering directly. IPC avoids stdio framing and
// remains unreferenceable under both Node and Bun while the renderer is idle.
const BOOTSTRAP = `
if (Number(process.versions.node.split('.')[0]) < 22) process.exit(3);
process.once('message', async message => {
  try {
    await import(message.entry ?? ('data:text/javascript;base64,' + Buffer.from(message.source).toString('base64')));
    process.send({ event: 'ready' });
  } catch { process.exit(1); }
});
process.send({ event: 'bootstrap' });
`

export class SourceRenderProcess extends EventEmitter {
  private readonly child: ChildProcess
  private ready = false
  private readonly pending: object[] = []

  constructor(source: string | URL, flags: readonly string[] = SOURCE_TOOL_NODE_FLAGS) {
    super()
    this.on('error', () => {})
    this.child = spawn(process.versions.bun ? 'node' : process.execPath, [...flags, '--input-type=module', '--eval', BOOTSTRAP], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_OPTIONS: '' },
    })
    // Reap the unreferenced idle process before natural parent shutdown.
    const shutdown = () => { this.ref(); this.terminate() }
    process.once('beforeExit', shutdown)
    this.child.on('message', (message: any) => {
      if (message.event === 'bootstrap') this.send(typeof source === 'string' ? { source } : { entry: source.href })
      else if (message.event === 'ready') {
        this.ready = true
        for (const queued of this.pending.splice(0)) this.send(queued)
      } else this.emit('message', message)
    })
    this.child.on('error', error => this.emit('error', error))
    // close also fires after a failed spawn, which has no exit event.
    this.child.once('close', (code, signal) => {
      process.removeListener('beforeExit', shutdown)
      if (!this.ready && code === 3) this.emit('error', Object.assign(new Error('Node 22 or later is required'), { code: 'NODE_RUNTIME_UNSUPPORTED' }))
      this.emit('exit', code, signal)
    })
  }

  postMessage(message: object): void {
    if (!this.ready) this.pending.push(message)
    else this.send(message)
  }
  terminate(): void { this.child.kill('SIGKILL') }
  ref(): void { this.child.ref(); (this.child.channel as { ref?: () => void } | undefined)?.ref?.() }
  unref(): void { (this.child.channel as { unref?: () => void } | undefined)?.unref?.(); this.child.unref() }

  private send(message: object): void {
    this.child.send(message, error => { if (error) this.emit('error', error) })
  }
}
