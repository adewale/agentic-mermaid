import { cpus, hostname, release } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { byteDigest, runtimeIdentity } from './artifacts.ts'

export function environmentIdentity(node: string) {
  const runtime = runtimeIdentity(node)
  return {
    runtime,
    nodeSha256: byteDigest(runtime.executable),
    host: hostname(),
    cpu: cpus().map(cpu => cpu.model),
    kernel: release(),
    cpuLimit: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null,
    memoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : null,
    environment: Object.fromEntries(['NODE_OPTIONS', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL', 'LC_NUMERIC', 'AGENTIC_MERMAID_EXPERIMENTS'].map(name => [name, process.env[name] ?? null])),
  }
}
