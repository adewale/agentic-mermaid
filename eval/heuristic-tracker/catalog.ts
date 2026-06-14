/**
 * Heuristic-tracker catalog: every example diagram we've used while tuning
 * the routing/port heuristics — problematic AND unproblematic — grouped by
 * the heuristic they exercise. `eval/heuristic-tracker/run.ts` scores each
 * one so a heuristic change can be measured for improvement vs. regression.
 *
 * Add an example by appending to the right group with a stable `name`; the
 * runner keys its baseline on `${group}/${name}`, so names must not change.
 */
import { contactSheetScenarios } from '../visual-rubric/scenarios.ts'

export interface TrackedExample {
  group: string
  name: string
  source: string
  /** Author's intent note — what a GOOD layout looks like here. */
  intent: string
}

const recip = (shape: (id: string) => string, labelled: boolean) =>
  labelled
    ? `flowchart LR\n  ${shape('A')} -- p --> ${shape('B')}\n  B -- q --> A`
    : `flowchart LR\n  ${shape('A')} --> ${shape('B')}\n  B --> A`

const SHAPES: Record<string, (id: string) => string> = {
  rectangle: i => `${i}[${i}]`, diamond: i => `${i}{${i}}`, circle: i => `${i}((${i}))`,
  hexagon: i => `${i}{{${i}}}`, stadium: i => `${i}([${i}])`, cylinder: i => `${i}[(${i})]`,
}

export function trackedExamples(): TrackedExample[] {
  const out: TrackedExample[] = []

  // Group 1 — the canonical contact sheet (A–V): the pinned "known good" set.
  for (const sc of contactSheetScenarios()) {
    out.push({ group: 'contact-sheet', name: sc.letter, source: sc.source, intent: sc.title })
  }

  // Group 2 — reciprocal pairs, every shape, labelled + unlabelled.
  for (const [name, shape] of Object.entries(SHAPES)) {
    out.push({ group: 'reciprocal-unlabelled', name, source: recip(shape, false),
      intent: 'two equal parallel lines, symmetric about the centerline, on-outline at designated points' })
    out.push({ group: 'reciprocal-labelled', name, source: recip(shape, true),
      intent: 'forward edge clean; backward leaves via an outer loop carrying its label' })
  }

  // Group 3 — peer fan-ins (unlabelled, single column) at several N: should be
  // mirror-symmetric (hub centered) and merge at one exact port.
  for (const shape of ['rectangle', 'circle', 'diamond'] as const) {
    for (const N of [2, 3, 4, 5]) {
      const lines = ['flowchart LR']
      for (let i = 0; i < N; i++) lines.push(`  ${SHAPES[shape](`S${i}`)} --> ${SHAPES[shape]('T')}`)
      out.push({ group: 'fan-in', name: `${shape}-N${N}`, source: lines.join('\n'),
        intent: 'hub centered on source barycenter; all edges merge at one exact port; mirror-symmetric' })
    }
  }

  // Group 4 — diamond off-port cases the 8-port idea targets.
  out.push({ group: 'diamond-offport', name: 'E-facet-spread',
    source: 'flowchart LR\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]',
    intent: 'two facet edges; designated attachment (facet-mid) and ideally port-to-port straight' })
  out.push({ group: 'diamond-offport', name: 'F-facet-spread-td',
    source: 'flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]', intent: 'as E, vertical' })
  out.push({ group: 'diamond-offport', name: 'K-side-input',
    source: 'flowchart LR\n  Q1{First} -- go --> Q2{Second}\n  X[Side input] --> Q2',
    intent: 'side input enters a designated port (ideally the S vertex when it sits below)' })
  out.push({ group: 'diamond-offport', name: 'three-way-out',
    source: 'flowchart LR\n  D{Check} --> A[Up]\n  D --> B[Mid]\n  D --> C[Down]',
    intent: 'three exits on designated points; no line floats at an arbitrary facet position' })

  // Group 5 — the MFA acceptance case (issue #25) — the original regression.
  out.push({ group: 'regression', name: 'mfa-login',
    source: 'flowchart LR\n  A[User] --> B[Login Page]\n  B --> C{Valid Credentials?}\n  C -- No --> B\n  C -- Yes --> D{MFA Enabled?}\n  D -- No --> G[Create Session]\n  D -- Yes --> E[Enter MFA Code]\n  E --> F{Code Valid?}\n  F -- No --> E\n  F -- Yes --> G',
    intent: 'every clear-lane edge straight; feedback loops outside; labels on their routes' })

  return out
}
