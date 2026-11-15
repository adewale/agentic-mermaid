import { trackedExamples } from '../heuristic-tracker/catalog.ts'

/** Exposed development corpus, fixed before implementation; not a holdout. */
export function cases() {
  const existing = trackedExamples().map(item => ({
    id: `${item.group}/${item.name}`, source: item.source,
    family: item.family ?? 'flowchart', origin: 'existing heuristic tracker',
  }))
  const additions = [
    ['long-labels', 'flowchart TD\nA[Authentication and authorization gateway] --> B[Validate incoming customer request]\nB --> C[Persist the final transaction result]\nA --> D[Record request tracing and audit information]\nD --> C'],
    ['unequal-ports', 'flowchart LR\nA[Very wide authentication and authorization gateway] --> C[OK]\nB[Input] --> C\nA --> D[Persist the transaction and return a response]\nC --> E[Done]\nD --> E'],
    ['source-order', 'flowchart TD\nA[One]\nB[Two]\nC[Three]\nD[Four]\nA --> D\nB --> C'],
    ['digits', 'flowchart LR\nA[11111111] -->|Authentication| B[88888888]\nB --> C[AVATAR]'],
    ['authored-breaks', 'flowchart TD\nA["Authentication<br/>must remain on this line"] --> B["Record request tracing and audit information"]'],
    ['joining-script', 'flowchart LR\nA["مرحبا بالعالم"] --> B["देवनागरी"]\nB --> C["中文 👩‍💻 é"]'],
  ].map(([id, source]) => ({ id: `campaign/${id}`, source: source!, family: 'flowchart', origin: 'purposeful campaign case' }))
  const scales = [16, 64, 160].map(n => ({
    id: `scaling/${n}`, family: 'flowchart', origin: 'declared scaling case',
    source: 'flowchart TD\n' + Array.from({ length: n }, (_, i) => `N${i}[Step ${i}]${i ? `\nN${Math.floor((i - 1) / 2)} --> N${i}` : ''}`).join('\n'),
  }))
  return [...existing, ...additions, ...scales]
}

export const timingIds = [
  'contact-sheet/A', 'contact-sheet/E', 'contact-sheet/I',
  'campaign/long-labels', 'campaign/unequal-ports', 'campaign/source-order',
  'campaign/digits', 'scaling/16', 'scaling/64',
  'family/sequence', 'family/class', 'family/er',
]
