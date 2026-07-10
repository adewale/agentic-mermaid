/**
 * Heuristic-tracker catalog: every example diagram we've used while tuning
 * the routing/port heuristics — problematic AND unproblematic — grouped by
 * the heuristic they exercise. `eval/heuristic-tracker/run.ts` scores each
 * one so a heuristic change can be measured for improvement vs. regression.
 *
 * Add an example by appending to the right group with a stable `name`; the
 * runner keys its baseline on `${group}/${name}`, so names must not change.
 *
 * NON-FLOWCHART families are first-class here too: an example with a `family`
 * field is scored via the family-generic rubric (src/family-rubric.ts) over
 * its RenderedLayout (plus the journey assessor for journey), while examples
 * without one keep the full flowchart assessLayout scoring. Group 9 enrolls
 * every registered family automatically from its canonical registry example,
 * so a NEW family enters the tracker the moment it joins the registry.
 */
import { contactSheetScenarios } from '../visual-rubric/scenarios.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import type { DiagramKind } from '../../src/agent/types.ts'

export interface TrackedExample {
  group: string
  name: string
  source: string
  /** Author's intent note — what a GOOD layout looks like here. */
  intent: string
  /** Diagram family; omitted means flowchart (scored via assessLayout). Any
   *  other value routes the example through the family rubric. */
  family?: DiagramKind
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
    const sh = SHAPES[shape]!
    for (const N of [2, 3, 4, 5]) {
      const lines = ['flowchart LR']
      for (let i = 0; i < N; i++) lines.push(`  ${sh(`S${i}`)} --> ${sh('T')}`)
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

  // Group 6 — label CENTRING on symmetric doglegs. A2/B2 feed A/B so the co-rank
  // squares A->B into a converging dogleg (markCorankFanInBundles), and C fans out
  // to D/E (applySymmetricFanoutEmissions). Both re-routes used to leave their
  // label hugging an endpoint (fan-in labelOff 0.28, fan-out 0.16) while staying
  // HARD-clean, so only the NEW worstLabelOffset metric sees it — this example
  // locks that class down. Toggling APL_NO_CORANK_FANIN changes this row's labelOff.
  out.push({ group: 'label-centring', name: 'symmetric-dogleg-labels',
    source: 'flowchart LR\n  A["warnings"] -->|warnings| B["ok"]\n  B -->|ok| C["rendered"]\n  A2["same word: warnings"] --> A\n  B2["same word: ok"] --> B\n  C -->|warnings| D["warnings"]\n  C -->|ok| E["ok"]',
    intent: 'every labelled edge label centred on its route (~midpoint), not hugging an endpoint' })

  // Group 7 — NON-RECT (diamond) hub centring. Every centring/co-rank/label-centring
  // heuristic used to bail on shape !== 'rectangle', so a DECISION diamond hub got
  // NO barycentre centring and reverted to ELK's off-centre placement. The guards
  // now admit PORT_EXACT hubs (and fan-in peers), so these centre just like a rect
  // hub. Both are LR so the tracker's fanInSymmetryError (y-axis) reads the cross
  // axis correctly. `mixed-hub` is a diamond fed by a labelled + an unlabelled edge
  // that ALSO fans out to two peers — a MIXED hub the alignPortLanes fan-in centring
  // cannot touch (it is unlabelled-only and single-forward-branch-only): the hub was
  // ~22px off its incoming barycentre before, ~0 now. `mixed-label-fanin` is the
  // co-ranked mixed-label fan-in whose labelled spoke also stops hugging its source.
  out.push({ group: 'diamond-hub', name: 'mixed-hub',
    source: 'flowchart LR\n  A["aa"] -->|lab| H{hub}\n  B["bb"] --> H\n  H --> C["c1"]\n  H --> D["c2"]',
    intent: 'the diamond hub sits on its incoming (rect) peer barycentre; both spokes converge symmetrically at its exact port' })
  out.push({ group: 'diamond-hub', name: 'mixed-label-fanin',
    source: 'flowchart LR\n  A["warnings"] -->|warnings| H{decision}\n  B["same word: ok"] --> H\n  H --> C["ok"]',
    intent: 'co-ranked mixed-label fan-in into a diamond hub: sources co-rank, hub centred, spokes converge, label near the route midpoint' })

  // Group 8 — journey stress set (the tiled-section/experience-curve rework
  // this loop previously could not see). Scored via the family rubric PLUS the
  // journey assessor: spans tile, markers on column centers, score→y monotone,
  // actor dots inside their task box.
  out.push({ group: 'journey', name: 'mermaid-docs-working-day', family: 'journey',
    source: 'journey\n  title My working day\n  section Go to work\n    Make tea: 5: Me\n    Go upstairs: 3: Me\n    Do work: 1: Me, Cat\n  section Go home\n    Go downstairs: 5: Me\n    Sit down: 5: Me',
    intent: 'the canonical Mermaid docs journey: two tiled sections, curve through five markers, Cat dot inside its task' })
  out.push({ group: 'journey', name: 'wide-section-label', family: 'journey',
    source: 'journey\n  title T\n  section A very long section label that is much wider than its tasks\n    Short: 3: Me\n  section Next\n    Task: 4: Me\n  section Third\n    Last: 2: Me',
    intent: 'a label wider than its tasks widens its own tile instead of overhanging the neighbor span' })
  out.push({ group: 'journey', name: 'many-tasks-15', family: 'journey',
    source: 'journey\n  title Fifteen tasks\n' + Array.from({ length: 5 }, (_, s) =>
      `  section S${s}\n` + Array.from({ length: 3 }, (_, t) => `    Task ${s}-${t}: ${((s + t) % 5) + 1}: Me`).join('\n')).join('\n'),
    intent: '15 tasks across 5 sections: all spans tile, every marker on its column, scores 1..5 strictly ordered on the curve' })
  out.push({ group: 'journey', name: 'multi-actor', family: 'journey',
    source: 'journey\n  title Crowd\n  section S\n' + Array.from({ length: 8 }, (_, i) => `    T${i}: ${(i % 5) + 1}: A${i}`).join('\n'),
    intent: '8 distinct actors: legend rows stay on-canvas, every actor dot inside its own task box' })

  // Group 9 — family citizenship: one canonical example per registered family
  // (from the registry's own `example`), scored via the family rubric so every
  // family has a baseline in this loop. Flowchart is skipped here — groups 1–7
  // already cover it with the full flowchart rubric. A NEW family added to
  // BUILTIN_FAMILY_METADATA is enrolled automatically.
  for (const fam of BUILTIN_FAMILY_METADATA) {
    if (fam.id === 'flowchart') continue
    out.push({ group: 'family', name: fam.id, family: fam.id, source: fam.example,
      intent: 'canonical registry example: finite geometry, on-canvas, no box overlap, groups tile and contain their members, labels present' })
  }

  return out
}
