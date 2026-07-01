// Label-CENTRING property gate (the gap that let the symmetric-dogleg hugging
// through).
//
// labelOffRoute (HARD) proves only that a label sits ON its route (the
// Kakoulis–Tollis edge-label association); it says NOTHING about WHERE along the
// route the label sits. A symmetric re-route — the co-rank mixed-label fan-in's
// converging dogleg (markCorankFanInBundles) or the fan-out's
// (applySymmetricFanoutEmissions) — can leave a label HARD-clean yet hugging an
// endpoint, where it reads as belonging to the node rather than the edge. That
// hugging slipped past labelOffRoute, the HARD gate, the byte-exact equivalence
// gate, AND the heuristic tracker: every one of them asserts the label is on its
// route, none that it is WELL-PLACED on it.
//
// This gate closes that gap with a PROPERTY over a representative set of
// label-bearing graphs (the repro graph — which carries BOTH a co-rank fan-in and
// a fan-out — plus a trivial single labelled edge and a labelled chain): every
// labelled edge's label must project onto its route within THRESHOLD of the route
// midpoint. The metric is labelMidpointOffset = |projFrac(label) - 0.5|
// (src/layout-rubric.ts): 0 is perfectly centred, →0.5 is jammed at an endpoint.
// dagre places edge labels at the route midpoint, so a correct layout scores ≈0.
//
// THRESHOLD = 0.18. Rationale: on the repro graph the NEW fan-in regression hugs
// at 0.277 BEFORE the fix — above 0.18, so this gate is RED on the pre-fix tree
// (the proof it catches the bug). The fix re-centres the co-rank fan-in's dogleg
// label onto the route's main-axis midpoint, dropping it to ~0.05 — under 0.18.
//
// The threshold deliberately TOLERATES the pre-existing fan-out hugging (0.160):
// that fan-out label is placed by the fan-out emitter's terminal-corridor
// BALANCER (terminalLabelRunLength / issue #38), which intentionally splits the
// outside-source corridor into three equal visible runs rather than centring on
// the full route — a placement re-centring would disturb (it breaks the tested
// expectBalancedTerminalLabelCorridor invariant). So the fix is scoped to the
// fan-in (the genuine regression) and the threshold is set just above the
// pre-existing fan-out so this gate does not demand undoing that deliberate
// design. 0.18 sits between the bug (0.277) and the tolerated fan-out (0.160).
// Reverting the fan-in re-centre turns this gate RED again — it is a
// bug-discriminating test, not a static guard.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { labelMidpointOffset } from '../layout-rubric.ts'

const THRESHOLD = 0.18

// Representative label-bearing graphs. SYMMETRIC is the repro: A2/B2 feed A/B so
// the co-rank squares A->B into a converging dogleg (the new fan-in regression),
// while C fans out to D/E (the pre-existing fan-out hugging). The others exercise
// a trivial single labelled edge and a labelled chain so the property is not
// over-fit to one graph.
const SYMMETRIC = [
  'flowchart LR',
  '  A["warnings"] -->|warnings| B["ok"]',
  '  B -->|ok| C["rendered"]',
  '  A2["same word: warnings"] --> A',
  '  B2["same word: ok"] --> B',
  '  C -->|warnings| D["warnings"]',
  '  C -->|ok| E["ok"]',
].join('\n')

// Scope note: this gate targets the SYMMETRIC-dogleg re-routes —
// markCorankFanInBundles (the fan-in regression) and applySymmetricFanoutEmissions
// (the pre-existing fan-out). A uniform all-labelled fan-in (e.g. three spokes all
// labelled into one hub) is NOT a co-rank mixed-label case and does NOT take the
// bundle re-route; its outer spokes are generic 'explained-detour' routes whose
// labels are placed by the general edge-label placer, a separate mechanism. We
// deliberately do not include such a graph here so the gate stays scoped to the
// one concern (the symmetric re-route's centring); that generic-detour hugging is
// called out as a known limitation, untouched by this change.
const GRAPHS: Array<{ name: string; source: string }> = [
  { name: 'symmetric-fan-in-and-fan-out (repro)', source: SYMMETRIC },
  { name: 'single-labelled-edge', source: 'flowchart LR\n  A[A] -->|x| B[B]' },
  { name: 'labelled-chain', source: 'flowchart LR\n  A[A] -->|go| B[B]\n  B -->|next| C[C]' },
]

describe('label centring (labelMidpointOffset)', () => {
  for (const { name, source } of GRAPHS) {
    test(`${name}: every labelled edge's label is centred on its route`, () => {
      const positioned = layoutGraphSync(parseMermaid(source))
      const labelled = positioned.edges.filter(e => e.label && e.labelPosition)
      expect(labelled.length).toBeGreaterThan(0)
      const offenders = labelled
        .map(edge => ({ edge: `${edge.source}->${edge.target}`, label: edge.label, offset: Number(labelMidpointOffset(edge).toFixed(3)) }))
        .filter(o => o.offset > THRESHOLD)
      // Empty unless a label hugs an endpoint; the array names the offending
      // edge(s) and their offset so a failure is self-explanatory.
      expect(offenders).toEqual([])
    })
  }
})
