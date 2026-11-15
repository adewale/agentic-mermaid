// RSS is a resident-memory observation, independent of V8 allocation accounting.
import { readFileSync } from 'node:fs'

export interface LinuxRssHighWater {
  linuxVmHwmBytes: number | null
  linuxVmHwmUnavailableReason: string | null
}

/** /proc reports the current address space's high-water mark, not an exec-
 * inherited getrusage maximum. Keep unavailable observations explicit. */
export function linuxRssHighWater(
  platform: string = process.platform,
  readStatus: () => string = () => readFileSync('/proc/self/status', 'utf8'),
): LinuxRssHighWater {
  const unavailable = (reason: string): LinuxRssHighWater => ({ linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: reason })
  if (platform !== 'linux') return unavailable('not-linux')
  let status: string
  try { status = readStatus() } catch { return unavailable('proc-self-status-unreadable') }
  const match = /^VmHWM:[ \t]+(\d+)[ \t]+kB[ \t]*$/m.exec(status)
  if (!match) return unavailable('proc-self-status-vmhwm-missing-or-invalid')
  const bytes = Number(match[1]) * 1024
  if (!Number.isSafeInteger(bytes) || bytes < 0) return unavailable('proc-self-status-vmhwm-out-of-range')
  return { linuxVmHwmBytes: bytes, linuxVmHwmUnavailableReason: null }
}

export type RssPhase = 'after-static-imports-before-job-and-package-loading'
  | 'after-package-imports-before-memory-warmup'
  | 'after-memory-measurement-and-final-gc'
export interface RssCheckpoint extends LinuxRssHighWater {
  phase: RssPhase
  currentRssBytes: number
  /** Process-lifetime getrusage maximum, including any inherited exec floor. */
  maxRssBytes: number
}
export interface ReleaseRssDiagnostics {
  workerStart: RssCheckpoint
  beforeMemoryWork: RssCheckpoint
  afterMemoryWork: RssCheckpoint
}

export function rssCheckpoint(phase: RssPhase): RssCheckpoint {
  return {
    phase,
    currentRssBytes: process.memoryUsage.rss(),
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    ...linuxRssHighWater(),
  }
}
