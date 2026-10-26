import { protocolIdentity } from '../unified/protocol-identity.ts'
import { executableIdentity } from '../unified/benchmark-context.ts'

/** Shared authored/observer contract, independent of each tool's API adapter.
 * Two reports with equal case names but different expectations cannot compose. */
export function fidelityCriteriaProtocol(root: string, browser: string) {
  return { producers: protocolIdentity(root, ['eval/benchmark/fidelity/protocol.ts', 'eval/benchmark/fidelity/cases.ts', 'eval/benchmark/fidelity/ledger.ts']), browser: executableIdentity(browser), viewport: { width: 1400, height: 1000 }, observer: 'isolated CSP; actual SVG; network restricted to declared fixture host/data/blob' }
}
