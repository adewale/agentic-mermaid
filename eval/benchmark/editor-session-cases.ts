/** Every edit changes visible content while preserving the graph's identities. */
export interface EditorSessionCase { id: string; family: string; source: string }
export function editorSessionCases(): EditorSessionCase[] {
  const tree = (nodes: number) => 'flowchart TD\n' + Array.from({ length: nodes - 1 }, (_, j) => {
    const i = j + 1, parent = Math.floor((i - 1) / 3)
    return `n${parent}[${parent === 0 ? 'BENCH_LABEL' : `Node ${parent}`}] --> n${i}[Node ${i}]`
  }).join('\n')
  return [
    ...[5, 50, 150].map(n => ({ id: `tree-${n}`, family: 'flowchart', source: tree(n) })),
    { id: 'nested-crosslinks', family: 'flowchart', source: 'flowchart LR\nsubgraph Frontend\na[BENCH_LABEL] --> b[Review]\nend\nsubgraph Backend\nc[Validate] --> d[Store]\nend\na --> c\nb --> d\nd --> b\nc --> a' },
    { id: 'sequence-40', family: 'sequence', source: 'sequenceDiagram\nparticipant A as BENCH_LABEL\nparticipant B as Service\nparticipant C as Store\n' + Array.from({ length: 20 }, (_, i) => `A->>B: Request ${i}\nB-->>A: Response ${i}`).join('\n') },
    { id: 'class-20', family: 'class', source: 'classDiagram\nclass Root {\n+String BENCH_LABEL\n}\n' + Array.from({ length: 20 }, (_, i) => `Root <|-- Type${i}\nclass Type${i} {\n+String name\n+save()\n}`).join('\n') },
    { id: 'er-20', family: 'er', source: 'erDiagram\nROOT {\nstring BENCH_LABEL\n}\n' + Array.from({ length: 20 }, (_, i) => `ROOT ||--o{ ENTITY${i} : contains\nENTITY${i} {\nint id\nstring name\n}`).join('\n') },
    { id: 'state-25', family: 'state', source: 'stateDiagram-v2\nstate "BENCH_LABEL" as Root\n[*] --> Root\n' + Array.from({ length: 25 }, (_, i) => `${i === 0 ? 'Root' : `S${i - 1}`} --> S${i}`).join('\n') },
    { id: 'mindmap-30', family: 'mindmap', source: 'mindmap\n  root((BENCH_LABEL))\n' + Array.from({ length: 5 }, (_, i) => `    Branch ${i}\n` + Array.from({ length: 5 }, (_, j) => `      Leaf ${i} ${j}`).join('\n')).join('\n') },
    { id: 'gantt-20', family: 'gantt', source: 'gantt\n  title BENCH_LABEL\n  dateFormat YYYY-MM-DD\n  section Delivery\n' + Array.from({ length: 20 }, (_, i) => `  Task ${i} :t${i}, 2026-01-${String(i + 1).padStart(2, '0')}, 3d`).join('\n') },
    { id: 'pie-12', family: 'pie', source: 'pie title BENCH_LABEL\n' + Array.from({ length: 12 }, (_, i) => `  "Category ${i}" : ${i + 1}`).join('\n') },
  ]
}
