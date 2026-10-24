import type { ChildProcess } from 'node:child_process'

// Community workers use private process groups so a stuck API can be killed.
// Forward cancellation through that extra group boundary before exiting.
const active = new Set<ChildProcess>()
let interrupted: NodeJS.Signals | undefined
let listening = false
function kill(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {}
}
function cancel(signal: NodeJS.Signals): void {
  if (interrupted) return
  interrupted = signal
  for (const child of active) kill(child, signal)
  // Keep this timer referenced: cleanup must finish even if all parents exit
  // before grandchildren that ignored the first signal.
  setTimeout(() => {
    for (const child of active) kill(child, 'SIGKILL')
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }, 1000)
}
const onInt = () => cancel('SIGINT')
const onTerm = () => cancel('SIGTERM')
export function assertCommunityNotInterrupted(): void {
  if (interrupted) throw new Error(`Community campaign cancelled by ${interrupted}; no further workers may start`)
}
export function trackCommunityProcess(child: ChildProcess): void {
  if (interrupted) {
    kill(child, 'SIGKILL')
    assertCommunityNotInterrupted()
  }
  active.add(child)
  if (!listening) {
    process.once('SIGINT', onInt)
    process.once('SIGTERM', onTerm)
    listening = true
  }
  child.once('close', () => {
    // During cancellation retain the group identity for forced descendant
    // cleanup even if the immediate child already stopped.
    if (interrupted) return
    active.delete(child)
    if (!active.size) {
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
      listening = false
    }
  })
}
