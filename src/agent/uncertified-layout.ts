// ============================================================================
// Findings for a drawing that did not pass layout certification.
//
// Report layout safety draws a diagram whose geometry or final paint fails
// certification only on drawable checks (src/layout/certification.ts,
// src/positioning.ts, paintCertificationRefuses in src/graphical-render.ts);
// strict safety refuses it. verify names every failed check so `ok` is false:
// a containment failure is GROUP_BREACH, and every other check is one
// LAYOUT_UNCERTIFIED per check class carrying the ids it names. Render
// surfaces read the same receipt (`receipt.layoutCertification`).
// ============================================================================

import type { UncertifiedLayoutReceipt } from '../layout/uncertified-layout.ts'
import { DRAWABLE_PAINT_FAILURES, type PaintLayoutCertification } from '../scene/paint-certification.ts'
import type { LayoutWarning } from './types.ts'

const MAX_MESSAGE_DETAILS = 3

/** `geometry` is the uncertified geometry receipt; `paintFailure` a failed
 * paint proof report safety drew anyway. Output order follows the receipts. */
export function uncertifiedLayoutWarnings(geometry: UncertifiedLayoutReceipt | undefined, paintFailure: PaintLayoutCertification | undefined): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const classes = new Map<string, { targets: Set<string>; details: string[] }>()
  const add = (violation: string, targets: readonly string[], detail: string): void => {
    const entry = classes.get(violation) ?? { targets: new Set<string>(), details: [] }
    classes.set(violation, entry)
    for (const target of targets) entry.targets.add(target)
    if (!entry.details.includes(detail)) entry.details.push(detail)
  }
  for (const violation of geometry?.violations ?? []) {
    if (violation.kind === 'groupBreaches' && violation.targets.length === 2) {
      const breach: LayoutWarning = { code: 'GROUP_BREACH', group: violation.targets[0]!, member: violation.targets[1]! }
      if (!warnings.some(warning => warning.code === 'GROUP_BREACH' && warning.group === breach.group && warning.member === breach.member)) warnings.push(breach)
    } else add(violation.kind, violation.targets, violation.detail)
  }
  for (const issue of paintFailure?.issues ?? []) {
    if (DRAWABLE_PAINT_FAILURES.has(issue.code)) add(issue.code, [issue.id, issue.by].filter((id): id is string => id !== undefined), `${issue.id ?? 'scene'}: ${issue.message}`)
  }
  for (const [violation, { targets, details }] of classes) {
    const shown = details.slice(0, MAX_MESSAGE_DETAILS).join('; ')
    const more = details.length > MAX_MESSAGE_DETAILS ? `; and ${details.length - MAX_MESSAGE_DETAILS} more` : ''
    warnings.push({ code: 'LAYOUT_UNCERTIFIED', violation, targets: [...targets].sort(), message: `Drawn without passing layout certification: ${shown}${more}` })
  }
  return warnings
}
