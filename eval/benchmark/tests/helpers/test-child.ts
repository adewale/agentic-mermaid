// Trident owns this test support; no product-test import is required.
import { afterEach } from 'bun:test'
import { spawn } from 'node:child_process'

interface ChildOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  input?: string
}

interface ChildResult {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface OwnedChild {
  handleOwnerEnd(): void
  stop(reason: string): Promise<void>
  terminated(): boolean
  diagnostic(): string
  unref(): void
}

/** Await a one-shot CLI's direct exit and complete output. Normal success does
 * not prove that descendants which redirected their own output have exited. */
export function useTestChildren(timeoutMs: number): (command: string, args: readonly string[], options?: ChildOptions) => Promise<ChildResult> {
  const pending = new Set<OwnedChild>()
  // Cleanup has its own short bound; it cannot permit a late successful test.
  const exitAckMs = 1000
  afterEach(async () => {
    const remaining = [...pending]
    const diagnostics = await Promise.all(
      remaining.map(async child => {
        child.handleOwnerEnd()
        await child.stop('owning test ended before child completion')
        if (!child.terminated()) await child.stop('retrying owner cleanup')
        const diagnostic = child.diagnostic()
        if (child.terminated()) pending.delete(child)
        else child.unref() // Retain identity/failure, but do not hang the failed worker.
        return diagnostic
      }),
    )
    if (remaining.length) throw new Error(`Owning test left child cleanup pending:\n${diagnostics.join('\n')}`)
  })

  return (command, args, options = {}) =>
    new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32'
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'pipe',
        detached: grouped,
      })
      const stdout: Buffer[] = [],
        stderr: Buffer[] = []
      const cleanupIssues: string[] = []
      let stdoutBytes = 0,
        stderrBytes = 0,
        settled = false,
        ownerEnded = false
      let exited = false,
        closed = false,
        cleanupConfirmed = false
      let groupSignalState = grouped ? 'not-requested' : 'unsupported'
      let failureReason: string | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      let cleanupAttempt: Promise<void> | undefined, failure: Promise<void> | undefined
      let acknowledgeExit!: () => void
      const directExit = new Promise<void>(resolve => {
        acknowledgeExit = resolve
      })
      const markExited = (): void => {
        exited = true
        acknowledgeExit()
      }
      // Match the previous spawnSync default; oversized output is a failure.
      const maxBuffer = 1024 * 1024
      const output = (): ChildResult => ({
        status: child.exitCode,
        signal: child.signalCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
      const clearDeadline = (): void => {
        if (deadline !== undefined) clearTimeout(deadline)
      }
      const awaitDirectExit = (): Promise<boolean> => {
        if (exited) return Promise.resolve(true)
        return new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), exitAckMs)
          void directExit.then(() => {
            clearTimeout(timer)
            resolve(true)
          })
        })
      }
      const diagnostic = (): string =>
        `${command} ${args.join(' ')} [pid=${child.pid ?? 'unassigned'}, initialGroupLeader=${grouped ? (child.pid ?? 'unassigned') : 'not-owned'}, groupSignal=${groupSignalState}, status=${child.exitCode}, signal=${child.signalCode}, directExit=${exited}, pipesClosed=${closed}, cleanupConfirmed=${cleanupConfirmed}, ownerEnded=${ownerEnded}]${cleanupIssues.length ? ` cleanup failures: ${cleanupIssues.join('; ')}` : ''}`
      const failureDiagnostic = (): string => {
        const captured = output()
        return `${diagnostic()}: ${failureReason ?? 'no failure recorded'}\nstdout:\n${captured.stdout}\nstderr:\n${captured.stderr}`
      }
      const ownsLiveLeader = (): boolean => !exited && child.pid !== undefined && child.exitCode === null && child.signalCode === null
      const terminate = (): Promise<void> => {
        // Terminal acknowledgement is permanent, even when history stays owned.
        if (cleanupConfirmed) return Promise.resolve()
        if (cleanupAttempt) return cleanupAttempt
        const attempt = (async () => {
          const issues: string[] = []
          let groupAbsent = false,
            directSignal: boolean | undefined
          const killDirect = (): void => {
            if (!ownsLiveLeader()) return
            try {
              directSignal = child.kill('SIGKILL')
            } catch (error) {
              issues.push(`direct kill failed: ${String(error)}`)
            }
          }
          // Do not address a numeric group after its direct leader has exited.
          // Descendants left after that point require external owned supervision.
          const leaderPid = child.pid
          if (grouped && leaderPid !== undefined && ownsLiveLeader()) {
            try {
              groupSignalState = 'requested-for-live-leader'
              if (!process.kill(-leaderPid, 'SIGKILL')) {
                groupSignalState = 'returned-false'
                issues.push('process-group kill returned false')
                killDirect()
              }
            } catch (error) {
              groupAbsent = (error as NodeJS.ErrnoException).code === 'ESRCH'
              groupSignalState = groupAbsent ? 'absent-for-live-leader' : 'failed-for-live-leader'
              if (!groupAbsent) issues.push(`process-group kill failed: ${String(error)}`)
              killDirect()
            }
          } else {
            if (grouped) groupSignalState = child.pid === undefined ? 'skipped-no-pid' : 'skipped-leader-not-live'
            killDirect()
          }
          // Never await descriptor closure on failure: a grandchild may own it.
          for (const pipe of [child.stdin, child.stdout, child.stderr]) {
            try {
              pipe.destroy()
            } catch (error) {
              issues.push(`pipe cleanup failed: ${String(error)}`)
            }
          }
          const acknowledged = await awaitDirectExit()
          if (!acknowledged) issues.push(`direct exit was not acknowledged within ${exitAckMs}ms`)
          if (directSignal === false && !acknowledged) issues.push('direct kill returned false without exit acknowledgement')
          if (groupAbsent && directSignal === true) issues.push('private process group was absent while the direct child was live')
          cleanupIssues.push(...issues)
          cleanupConfirmed = acknowledged && issues.length === 0
          // Historical failures stay owned for afterEach to retry and report.
          if (cleanupConfirmed && cleanupIssues.length === 0) pending.delete(owned)
        })()
        cleanupAttempt = attempt
        void attempt.then(() => {
          if (cleanupAttempt === attempt) cleanupAttempt = undefined
        })
        return attempt
      }
      const stop = (reason: string): Promise<void> => {
        // Late errors and afterEach history reporting cannot restart cleanup.
        if (cleanupConfirmed) return failure ?? Promise.resolve()
        if (settled && failureReason === undefined) return Promise.resolve()
        failureReason ??= reason
        clearDeadline()
        const attempt = terminate()
        failure ??= attempt.then(() => {
          // The owner already failed. Do not resume its abandoned async body.
          if (settled || ownerEnded) return
          settled = true
          reject(new Error(failureDiagnostic()))
        })
        return attempt
      }
      const owned: OwnedChild = {
        handleOwnerEnd: () => {
          // Only afterEach disposes an owned call; settled and owner-ended are
          // separate so disposal cannot skip the bounded cleanup below.
          ownerEnded = true
          clearDeadline()
        },
        stop,
        terminated: () => cleanupConfirmed,
        diagnostic: failureDiagnostic,
        unref: () => child.unref(),
      }
      pending.add(owned)
      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        if (settled || ownerEnded || failureReason !== undefined) return
        const bytes = Buffer.from(chunk)
        const size = stream === 'stdout' ? stdoutBytes : stderrBytes
        const available = maxBuffer - size
        if (stream === 'stdout') stdoutBytes += Math.min(available, bytes.byteLength)
        else stderrBytes += Math.min(available, bytes.byteLength)
        ;(stream === 'stdout' ? stdout : stderr).push(bytes.subarray(0, available))
        if (bytes.byteLength > available) void stop(`${stream} exceeded the ${maxBuffer}-byte capture limit (output is partial)`)
      }
      child.stdout.on('data', chunk => collect('stdout', chunk))
      child.stderr.on('data', chunk => collect('stderr', chunk))
      child.stdin.on('error', error => {
        void stop(`stdin failed: ${error.message}`)
      })
      child.stdout.on('error', error => {
        void stop(`stdout failed: ${error.message}`)
      })
      child.stderr.on('error', error => {
        void stop(`stderr failed: ${error.message}`)
      })
      child.on('exit', markExited)
      child.on('error', error => {
        if (child.pid === undefined) markExited() // Failed spawn has no process to reap.
        void stop(`spawn failed: ${error.message}`)
      })
      child.on('close', () => {
        markExited()
        closed = true
        if (settled || ownerEnded || failureReason !== undefined) return
        settled = true
        clearDeadline()
        pending.delete(owned)
        resolve(output())
      })
      deadline = setTimeout(() => {
        void stop(`child or inherited pipes exceeded ${timeoutMs}ms`)
      }, timeoutMs)
      try {
        child.stdin.end(options.input)
      } catch (error) {
        void stop(`stdin failed: ${String(error)}`)
      }
    })
}
