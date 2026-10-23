// Standalone public-API fixtures. Tokens change visible labels, not comments.
export const fixtures = [
  { id: 'empty', source: 'flowchart TD', variant: false },
  { id: 'zero-edge-one-node', source: 'flowchart TD\nN0["Node 0 __VARIANT__"]' },
  { id: 'sparse8', source: ['flowchart TD', 'N0["Node 0 __VARIANT__"]', ...Array.from({ length: 7 }, (_, i) => `N${i + 1}["Node ${i + 1}"]`), 'N0 --> N1', 'N2 --> N3', 'N4 --> N5', 'N6 --> N7'].join('\n') },
  ...[50, 150, 400].map(n => ({ id: `chain-feedback${n}`, source: ['flowchart TD', 'N0["Node 0 __VARIANT__"]', ...Array.from({ length: n - 1 }, (_, i) => `N${i + 1}["Node ${i + 1}"]`), ...Array.from({ length: n - 1 }, (_, i) => `N${i} --> N${i + 1}`), ...Array.from({ length: Math.floor((n - 1) / 7) }, (_, i) => `N${7 * (i + 1)} --> N${7 * (i + 1) - 5}`), `N${n - 1} --> N0`].join('\n') })),
  { id: 'branch-feedback50', source: ['flowchart TD', 'N0["Node 0 __VARIANT__"]', ...Array.from({ length: 49 }, (_, i) => `N${i + 1}["Node ${i + 1}"]`), ...Array.from({ length: 49 }, (_, i) => `N${Math.floor(i / 2)} --> N${i + 1}`), ...Array.from({ length: 25 }, (_, i) => `N${i + 25} --> N0`)].join('\n') },
  { id: 'nested', source: ['flowchart TD', 'subgraph Outer', 'subgraph Left', 'N0["Node 0 __VARIANT__"]', 'N1', 'N0 --> N1', 'end', 'subgraph Right', 'N2', 'N3', 'N2 --> N3', 'end', 'N1 --> N2', 'N3 --> N0', 'end', 'Outside --> N0', 'N3 --> Outside'].join('\n') },
  { id: 'sequence20-negative-control', source: ['sequenceDiagram', 'participant A as Alice __VARIANT__', 'participant B as Bob', ...Array.from({ length: 20 }, (_, i) => `${i % 2 ? 'B->>A' : 'A->>B'}: Message ${i}`)].join('\n') },
]
export function sourceFor(fixture, token) { return fixture.source.replace('__VARIANT__', token) }
