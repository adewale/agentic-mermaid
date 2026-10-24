import { readdirSync, readFileSync } from 'node:fs'

interface ProcessIdentity {
  pid: number
  start: string
  state: string
  parent: number
}

function identity(pid: number): ProcessIdentity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
    if (!fields[19]) return undefined
    return { pid, state: fields[0]!, parent: Number(fields[1]), start: fields[19]! }
  } catch {
    return undefined
  }
}

/** Detached descendants belong to the benchmark even after changing sessions.
 * Discover only on termination, keeping process inspection out of API clocks.
 * Linux start times prevent signalling a later process that reused a PID. */
export function subprocessTreeTerminator(rootPid: number, fallback: (signal: NodeJS.Signals) => void) {
  const initialRoot = process.platform === 'linux' ? identity(rootPid) : undefined
  const known = new Map<number, ProcessIdentity>(initialRoot ? [[rootPid, initialRoot]] : [])
  const discover = (pid: number, seen: Set<number>) => {
    if (seen.has(pid)) return
    seen.add(pid)
    const current = identity(pid)
    if (!current || (known.has(pid) && known.get(pid)!.start !== current.start)) return
    known.set(pid, current)
    try {
      for (const task of readdirSync(`/proc/${pid}/task`)) {
        let children: string
        try {
          children = readFileSync(`/proc/${pid}/task/${task}/children`, 'utf8')
        } catch {
          continue
        }
        for (const value of children.trim().split(/\s+/)) {
          const child = Number(value)
          if (Number.isSafeInteger(child) && child > 0) discover(child, seen)
        }
      }
    } catch {}
  }
  const signal = (value: NodeJS.Signals) => {
    if (process.platform !== 'linux') return fallback(value)
    const seen = new Set<number>()
    // Some kernels omit task/children. A termination-only PPID snapshot also
    // finds descendants that changed process groups without clock overhead.
    let entries: string[]
    try {
      entries = readdirSync('/proc')
    } catch {
      if (initialRoot?.start === identity(rootPid)?.start) fallback(value)
      return
    }
    const snapshot = entries
      .filter(value => /^\d+$/.test(value))
      .map(value => identity(Number(value)))
      .filter((value): value is ProcessIdentity => Boolean(value))
    const pending = [rootPid, ...known.keys()]
    const visited = new Set<number>()
    while (pending.length) {
      const pid = pending.pop()!
      if (visited.has(pid)) continue
      visited.add(pid)
      const record = snapshot.find(value => value.pid === pid)
      if (pid === rootPid && (!initialRoot || record?.start !== initialRoot.start)) continue
      if (record && (!known.has(pid) || known.get(pid)!.start === record.start)) {
        known.set(pid, record)
        for (const child of snapshot) if (child.parent === pid) pending.push(child.pid)
      }
    }
    if (initialRoot && identity(rootPid)?.start === initialRoot.start) discover(rootPid, seen)
    for (const record of [...known.values()]) {
      if (identity(record.pid)?.start === record.start) discover(record.pid, seen)
    }
    const root = known.get(rootPid)
    if (root && root.start === identity(rootPid)?.start) fallback(value)
    for (const record of [...known.values()].reverse()) {
      const current = identity(record.pid)
      if (current?.start !== record.start || current.state === 'Z') continue
      try {
        process.kill(record.pid, value)
      } catch {}
    }
  }
  const finish = async () => {
    if (process.platform !== 'linux' || !known.size) return
    signal('SIGKILL')
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const alive = [...known.values()].some(record => {
        const current = identity(record.pid)
        return current?.start === record.start && current.state !== 'Z'
      })
      if (!alive) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('Timed-out benchmark descendants did not terminate; refusing to continue clocks')
  }
  return { signal, finish }
}
