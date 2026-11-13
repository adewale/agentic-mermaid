/** Historical AM report semantics live in the exact pinned Trident library. */
export { updateCommunityScorecard, type ScorecardSelection } from 'trident/unified/update-scorecard.ts'

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { prepareTrident } from '../../trident/prepare.ts'

if (import.meta.main) {
  const trident = prepareTrident()
  const result = spawnSync(process.execPath, [join(trident, 'unified/update-scorecard.ts'), ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
