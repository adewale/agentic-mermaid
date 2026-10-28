import type { UnifiedSuiteResult } from 'trident/unified/types.ts'

const catalogVariant = (variant?: string): string => 'catalog-release' + (variant && variant !== 'candidate' && variant !== 'default' ? ':' + variant : '')

/** The product ledger also retains neutral catalog runs. Keep their actual
 * release versions distinct from the selected product candidate, for every
 * project. This is a report view; immutable owning records stay unchanged. */
export function catalogReleaseView(result: UnifiedSuiteResult): UnifiedSuiteResult {
  return {
    ...result,
    ...(result.toolVersions ? { toolVersions: result.toolVersions.map(claim => ({ ...claim, variant: catalogVariant(claim.variant) })) } : {}),
    observations: result.observations.map(row => {
      const metrics = row.metrics
      const owner = metrics?.variantOf ?? metrics?.implementation ?? metrics?.project
      return typeof owner === 'string' && owner.trim()
        ? { ...row, metrics: { ...metrics, variant: catalogVariant(typeof metrics?.variant === 'string' ? metrics.variant : undefined) } }
        : row
    }),
  }
}
