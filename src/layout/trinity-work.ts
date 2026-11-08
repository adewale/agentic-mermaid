import { LayoutWorkLimitError } from './backend.ts'
import type { ChannelWork } from './channel-tracks.ts'

/** Admission checks precede capability declines, including unsupported sizes. */
export function assertTrinityWork(work: ChannelWork): void {
  for (const resource of ['pairs', 'arcs', 'swaps'] as const) {
    if (!Number.isFinite(work[resource])) throw new TypeError('Invalid Trinity work ledger')
    if (work[resource] < 0) throw new LayoutWorkLimitError(resource)
  }
}
