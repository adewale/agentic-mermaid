// docs/choosing-a-diagram.md tells agents which warning codes each tier
// raises; those assignments must be the runtime's.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WARNING_TIER, type WarningCode, type WarningTier } from '../agent/types.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('family router warning tiers', () => {
  test('the family router assigns named warning codes to their runtime tiers', () => {
    const router = readFileSync(join(ROOT, 'docs', 'choosing-a-diagram.md'), 'utf8')
    const verification = router.split('## Verify what the family promised')[1] ?? ''
    const tierNames: Record<string, WarningTier> = { '1': 'structural', '2': 'geometric', '3': 'lint' }
    const checked = new Set<WarningCode>()
    const seenTiers = new Set<WarningTier>()

    for (const match of verification.matchAll(/^- \*\*Tier ([123]) — [^*]+:\*\*([\s\S]*?)(?=^- \*\*Tier |\n\n)/gm)) {
      const expectedTier = tierNames[match[1]!]!
      seenTiers.add(expectedTier)
      for (const codeMatch of match[2]!.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) {
        const code = codeMatch[1] as WarningCode
        expect({ code, known: code in WARNING_TIER }).toEqual({ code, known: true })
        expect({ code, tier: WARNING_TIER[code] }).toEqual({ code, tier: expectedTier })
        checked.add(code)
      }
    }

    expect(seenTiers).toEqual(new Set<WarningTier>(['structural', 'geometric', 'lint']))
    expect(checked.size).toBeGreaterThan(0)
  })
})
