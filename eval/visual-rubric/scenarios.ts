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
    // E–F: a diamond side carrying TWO forward edges. The edges spread across
    // the facet/side instead of stacking on the vertex, and equivalent branches
    // keep mirrored routes with labels on their own segments.
    { letter: 'E', title: 'diamond fan-out — facet-mid ports, symmetric branch routes', source: 'flowchart LR\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]' },
    { letter: 'F', title: 'diamond fan-out, TD — facet-mid ports, symmetric branch routes', source: 'flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]' },
    // G–H: reciprocal pairs. H (rects): two equal parallel lines at
    // center ± PAIR_SEPARATION/2. G (diamond↔diamond): the pair attaches at
    // the NEAREST facing facet-mid ports — Q.NE→R.NW (upper), R.SW→Q.SE
    // (lower) — two parallel lines BETWEEN the diamonds, never through them.
    { letter: 'G', title: 'bi-directional diamonds — parallel lines on facet-mid ports', source: 'flowchart LR\n  Q{One} --> R{Two}\n  R --> Q' },
    { letter: 'H', title: 'bi-directional rects — two EQUAL parallel lines', source: 'flowchart LR\n  A[One] --> B[Two]\n  B --> A' },
    // I–J: diamond chains run vertex to vertex.
    { letter: 'I', title: 'diamond chain — vertex to vertex', source: 'flowchart LR\n  Q1{One} --> Q2{Two} --> Q3{Three}' },
    { letter: 'J', title: 'diamond chain, TD — vertex to vertex', source: 'flowchart TD\n  Q1{One} --> Q2{Two} --> Q3{Three}' },
    // K: the labelled main branch runs vertex-to-vertex (E→W); the side input
    // sits below Q2, whose W vertex is taken, so it routes into Q2's S vertex
    // (a canonical port) instead of floating on the W facet.
    { letter: 'K', title: 'side input into a claimed diamond — enters the S vertex', source: 'flowchart LR\n  Q1{First} -- go --> Q2{Second}\n  X[Side input] --> Q2' },
    // L–P: the PORT_EXACT extension — port-only and curved shapes get the
    // same SYMMETRIC merge as rects: active fan-in centering snaps the hub
    // onto the source barycenter, so both edges bend equally into one exact
    // port (mirror-symmetric), for every shape.
    { letter: 'L', title: 'circle fan-in — symmetric merge at the exact port', source: fanIn('((One))', '((Hub))', '((Two))') },
    { letter: 'M', title: 'stadium fan-in — symmetric merge at the exact port', source: fanIn('([One])', '([Hub])', '([Two])') },
    { letter: 'N', title: 'hexagon fan-in — symmetric merge at the exact port', source: fanIn('{{One}}', '{{Hub}}', '{{Two}}') },
    { letter: 'O', title: 'cylinder fan-in — symmetric merge at the exact port', source: fanIn('[(One)]', '[(Hub)]', '[(Two)]') },
    { letter: 'P', title: 'mixed rect→circle fan-in — symmetric merge', source: fanIn('[One]', '((Hub))', '[Two]') },
    // Q: state diagrams inherit the whole composition (states are
    // rect-like; pseudostates are port-only circles).
    { letter: 'Q', title: 'state diagram fan-in — symmetric merge', source: 'stateDiagram-v2\n  direction LR\n  Choosing --> Done\n  Reviewing --> Done' },
    // R: labeled feedback routes around through the outer channel with its
    // label ON the loop; the forward edge stays straight.
    { letter: 'R', title: 'labeled feedback — outer loop, label on route', source: 'flowchart LR\n  A[Request] --> B{Valid?}\n  B -- no, retry --> A\n  B -- yes --> C[Process]' },
    // S: reciprocal circles — port-only shapes cannot offset a pair, so the
    // forward edge takes the exact port and the back edge loops around.
    { letter: 'S', title: 'bi-directional circles — port + outer loop', source: 'flowchart LR\n  A((One)) --> B((Two))\n  B --> A' },
    // T–V: the slanted-family PORT_EXACT extension — parallelograms,
    // trapezoids and asymmetric flags get the same symmetric merge (E/W
    // ports on the slant midpoints / the flag point).
    { letter: 'T', title: 'parallelogram I/O fan-in — symmetric merge', source: fanIn('[/One/]', '[/Hub/]', '[/Two/]') },
    { letter: 'U', title: 'trapezoid fan-in — symmetric merge', source: fanIn('[/One\\]', '[/Hub\\]', '[/Two\\]') },
    { letter: 'V', title: 'asymmetric fan-in — symmetric merge at the flag point', source: fanIn('>One]', '>Hub]', '>Two]') },
    // W–AO: symmetry floor scenarios from the route/port/symmetry visual
    // exploration. These lock in the broader rule: equivalent edges should
    // look equivalent, but high-degree trunks should not be forced into boxes.
    { letter: 'W', title: 'product loop — TD decision branch symmetry', source: `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end` },
    { letter: 'X', title: 'three-way TD decision — equivalent branch spread', source: `flowchart TD
  Q{Decision} -->|left| L[Left]
  Q -->|middle| M[Middle]
  Q -.->|right| R[Right]` },
    { letter: 'Y', title: 'five-way fan-in — centered high-degree hub', source: `flowchart TD
  Web[Web App] --> Gateway
  Mobile[Mobile App] --> Gateway
  CLI[CLI Tool] --> Gateway
  Partner[Partner API] --> Gateway
  Cron[Cron Jobs] --> Gateway
  Gateway --> Auth[Auth Service]` },
    { letter: 'Z', title: 'dispatcher 4-way fan-out — shared trunk, no box', source: `flowchart TD
  Dispatcher --> Email[Email Worker]
  Dispatcher --> SMS[SMS Worker]
  Dispatcher --> Push[Push Worker]
  Dispatcher --> Webhook[Webhook Worker]` },
    { letter: 'AA', title: 'LR fan-in + fan-out — symmetric hub treatment', source: `flowchart LR
  A[Ingest A] --> Q[Queue]
  B[Ingest B] --> Q
  C[Ingest C] --> Q
  Q --> W1[Worker 1]
  Q --> W2[Worker 2]
  Q --> W3[Worker 3]` },
    { letter: 'AB', title: 'labeled TD fan-out — labels remain route-owned', source: `flowchart TB
  Src["Source"]
  Left["Left Target"]
  Center["Center Target"]
  Right["Right Target"]
  Src -->|left*| Left
  Src -->|center*| Center
  Src -->|right*| Right` },
    { letter: 'AC', title: '&-declared fan-out — compact syntax symmetry', source: `flowchart TD
  A --> B & C & D` },
    { letter: 'AD', title: 'diamond fan-out TD — symmetric doglegs', source: `flowchart TD
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]` },
    { letter: 'AE', title: 'sibling source fan-out — source-side symmetry', source: `flowchart TB
  Src["Source"]
  Left["Left Target"]
  Center["Center Target"]
  Right["Right Target"]
  Src -->|left*| Left
  Src -->|center*| Center
  Src -->|right*| Right` },
    { letter: 'AF', title: 'labeled LR fan-out connector — no detached labels', source: `flowchart LR
  Src["Source"]
  Top["Top Target"]
  Mid["Middle Target"]
  Bot["Bottom Target"]
  Src -->|top*| Top
  Src -->|mid*| Mid
  Src -->|bot*| Bot` },
    { letter: 'AG', title: 'fan-in/fan-out corridor reuse — reciprocal hub symmetry', source: `flowchart LR
  A --> C
  B --> C
  C --> D
  C --> E` },
    { letter: 'AH', title: 'target-aware fan-in grouping — repeated peers', source: `flowchart TD
  A1 --> A
  A2 --> A
  B1 --> B
  B2 --> B
  A --> C
  B --> C` },
    { letter: 'AI', title: 'dense TD bundles — equal peers + owned chain', source: `flowchart TD
  A["AAA<br>(keita)"] --> C["CCC"]
  B["BBB<br>(yuriko)"] --> C
  C --> D["DDDD"]
  D --> E["EEEE"]
  A1["1 / 2"] --> A
  A2["3 / 4"] --> A
  A3["5 / 6"] --> A
  A4["XXX<br>(YYY ZZZ)"] --> A
  B1["77 77<br>(7 / 7 / 7)"] --> B
  B2["88-88<br>(99 99)"] --> B
  B3["111s 222s"] --> B
  D --> F{"F?"}
  F -->|Yes| G["High level<br>Tr"]
  F -->|No| H["Dumb Tr<br>S"]` },
    { letter: 'AJ', title: 'dense overlapping-curve pattern — symmetric parallel labels', source: `flowchart TD
  Z[Start] -->|long 1| A[Alpha]
  Z -->|long 2| A
  A -->|3| B[Beta]
  A -->|4| B
  B -->|5| C[Gamma]
  B -->|6| D[Delta]
  C -->|7| D
  D -->|8| E[End]
  B -->|9| A
  C -->|10| A
  D -->|11| A
  B -->|12| B
  C -->|13| B
  D -->|14| B
  C -->|18| C
  D -->|21| D` },
    { letter: 'AK', title: 'equivalent peer fan-in groups', source: `flowchart TD
  A1[A1] --> A[A]
  A2[A2] --> A
  B1[B1] --> B[B]
  B2[B2] --> B` },
    { letter: 'AL', title: 'equivalent terminal peer fan-out', source: `flowchart TD
  Source[Source] --> Left[Left]
  Source --> Mid[Middle]
  Source --> Right[Right]` },
    { letter: 'AM', title: 'two-sided hub symmetry', source: `flowchart LR
  A[A] --> C[Hub]
  B[B] --> C
  C --> D[D]
  C --> E[E]` },
    { letter: 'AN', title: 'repeated equivalent subtrees', source: `flowchart TD
  A1[A1] --> A[A]
  A2[A2] --> A
  B1[B1] --> B[B]
  B2[B2] --> B
  C1[C1] --> C[C]
  C2[C2] --> C
  A --> Merge[Merge]
  B --> Merge
  C --> Merge
  Merge --> Done[Done]` },
    { letter: 'AO', title: 'reciprocal peer merge/fan-out', source: `flowchart TD
  A[A] --> C[C]
  B[B] --> C
  C --> D[D]
  C --> E[E]
  D --> F[F]
  E --> F` },
  ]
}
