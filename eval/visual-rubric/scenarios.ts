/**
 * The contact-sheet scenarios: the canonical port-ranking / port-alignment
 * examples, lettered so they can be referenced unambiguously in reviews
 * ("B's upper arrow", "the G pair").
 *
 * These are SHARED between:
 *  - the contact-sheet generator (`bun run contact:sheet`), which renders
 *    them into one human-reviewable PNG, and
 *  - `src/__tests__/contact-sheet.test.ts`, which pins each scenario's
 *    layout geometry (drift-sentinel snapshots) and asserts the rubric's
 *    hard metrics stay zero — so future versions of the codebase cannot
 *    visually break these scenarios without a deliberate re-pin.
 *
 * Adding a scenario: append a new letter (never reuse or reorder letters —
 * they are stable references), then update the snapshots and regenerate the
 * sheet for review.
 */
export interface ContactSheetScenario {
  letter: string
  title: string
  source: string
}

export function contactSheetScenarios(): ContactSheetScenario[] {
  const fanIn = (a: string, t: string, b: string) =>
    `flowchart LR\n  A${a} --> T${t}\n  B${b} --> T`
  return [
    // A–D: single line out of a diamond, all four directions. The labeled
    // main branch runs straight out of the vertex into the target's exact
    // port (port-lane alignment slides the target onto the vertex lane);
    // the side input converges at the same entry port (fan-in merge).
    { letter: 'A', title: '1 line, LR — vertex emit + port merge', source: 'flowchart LR\n  Q{Decide} -- go --> T[Target]\n  X[Side input] --> T' },
    { letter: 'B', title: '1 line, RL — vertex emit + port merge', source: 'flowchart RL\n  Q{Decide} -- go --> T[Target]\n  X[Side input] --> T' },
    { letter: 'C', title: '1 line, TD — vertex emit + port merge', source: 'flowchart TD\n  Q{Decide} -- go --> T[Target]\n  X[Side input] --> T' },
    { letter: 'D', title: '1 line, BT — vertex emit + port merge', source: 'flowchart BT\n  Q{Decide} -- go --> T[Target]\n  X[Side input] --> T' },
    // E–F: a diamond side carrying TWO lines spreads on the facet — the
    // vertex has capacity 1 (yFiles cost model), no line hogs the point.
    { letter: 'E', title: '2 lines — facet spread', source: 'flowchart LR\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]' },
    { letter: 'F', title: '2 lines, TD — facet spread', source: 'flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]' },
    // G–H: reciprocal pairs render as TWO EQUAL parallel lines at
    // center ± PAIR_SEPARATION/2 (primary low, feedback high).
    { letter: 'G', title: 'bi-directional diamonds — two EQUAL parallel lines', source: 'flowchart LR\n  Q{One} --> R{Two}\n  R --> Q' },
    { letter: 'H', title: 'bi-directional rects — two EQUAL parallel lines', source: 'flowchart LR\n  A[One] --> B[Two]\n  B --> A' },
    // I–J: diamond chains run vertex to vertex.
    { letter: 'I', title: 'diamond chain — vertex to vertex', source: 'flowchart LR\n  Q1{One} --> Q2{Two} --> Q3{Three}' },
    { letter: 'J', title: 'diamond chain, TD — vertex to vertex', source: 'flowchart TD\n  Q1{One} --> Q2{Two} --> Q3{Three}' },
    // K: misaligned diamonds — port-lane alignment slides the second
    // diamond onto the first's vertex lane: vertex-to-vertex straight.
    { letter: 'K', title: 'misaligned diamonds — vertex to vertex', source: 'flowchart LR\n  Q1{First} -- go --> Q2{Second}\n  X[Side input] --> Q2' },
    // L–P: the PORT_EXACT extension — port-only and curved shapes get the
    // same port-to-port straight + merge composition as rects.
    { letter: 'L', title: 'circle fan-in — port-to-port straight + merge', source: fanIn('((One))', '((Hub))', '((Two))') },
    { letter: 'M', title: 'stadium fan-in — port-to-port straight + merge', source: fanIn('([One])', '([Hub])', '([Two])') },
    { letter: 'N', title: 'hexagon fan-in — port-to-port straight + merge', source: fanIn('{{One}}', '{{Hub}}', '{{Two}}') },
    { letter: 'O', title: 'cylinder fan-in — port-to-port straight + merge', source: fanIn('[(One)]', '[(Hub)]', '[(Two)]') },
    { letter: 'P', title: 'mixed rect→circle fan-in', source: fanIn('[One]', '((Hub))', '[Two]') },
    // Q: state diagrams inherit the whole composition (states are
    // rect-like; pseudostates are port-only circles).
    { letter: 'Q', title: 'state diagram fan-in — alignment + merge', source: 'stateDiagram-v2\n  direction LR\n  Choosing --> Done\n  Reviewing --> Done' },
    // R: labeled feedback routes around through the outer channel with its
    // label ON the loop; the forward edge stays straight.
    { letter: 'R', title: 'labeled feedback — outer loop, label on route', source: 'flowchart LR\n  A[Request] --> B{Valid?}\n  B -- no, retry --> A\n  B -- yes --> C[Process]' },
    // S: reciprocal circles — port-only shapes cannot offset a pair, so the
    // forward edge takes the exact port and the back edge loops around.
    { letter: 'S', title: 'bi-directional circles — port + outer loop', source: 'flowchart LR\n  A((One)) --> B((Two))\n  B --> A' },
  ]
}
