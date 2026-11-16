import { test } from 'bun:test'

const cases = [
  {
    name: 'labels and authored identity-like data',
    graph: {
      id: 'root', $H: 47, layoutOptions: { 'elk.algorithm': 'layered' },
      children: [{ id: 'α', width: 30.2, height: 20.7, labels: [{ text: 'λ' }], metadata: { $H: 0 } }, { id: 'b', width: 40.3, height: 30.1 }],
      edges: [{ id: 'ab', sources: ['α'], targets: ['b'], labels: [{ text: 'center', width: 24.3, height: 11.7 }, { text: 'head', width: 15.7, height: 7.3, layoutOptions: { 'elk.edgeLabels.placement': 'HEAD' } }, { text: 'tail', width: 12.3, height: 5.9, layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' } }] }],
    },
  },
  {
    name: 'cycles',
    graph: {
      id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'LEFT' },
      children: [{ id: 'a', width: 30.2, height: 20.7 }, { id: 'b', width: 40.3, height: 30.1 }, { id: 'c', width: 35.9, height: 25.4 }],
      edges: [{ id: 'ab', sources: ['a'], targets: ['b'] }, { id: 'bc', sources: ['b'], targets: ['c'] }, { id: 'ca', sources: ['c'], targets: ['a'] }],
    },
  },
  {
    name: 'inverted and north/south ports',
    graph: {
      id: 'root', layoutOptions: { 'elk.algorithm': 'layered' },
      children: [
        { id: 'a', width: 40.3, height: 30.7, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }, ports: [{ id: 'aw', width: 2.3, height: 1.7, layoutOptions: { 'elk.port.side': 'WEST' } }, { id: 'au', layoutOptions: { 'elk.port.side': 'NORTH' } }] },
        { id: 'b', width: 50.3, height: 40.7, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }, ports: [{ id: 'be', width: 2.3, height: 1.7, layoutOptions: { 'elk.port.side': 'EAST' } }, { id: 'bs', layoutOptions: { 'elk.port.side': 'SOUTH' } }] },
        { id: 'c', width: 36.3, height: 25.1, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }, ports: [{ id: 'cn', layoutOptions: { 'elk.port.side': 'NORTH' } }, { id: 'cu', layoutOptions: { 'elk.port.side': 'WEST' } }] },
      ],
      edges: [{ id: 'ab', sources: ['aw'], targets: ['be'] }, { id: 'bc', sources: ['bs'], targets: ['cn'] }],
    },
  },
  {
    name: 'self-loops',
    graph: {
      id: 'root', layoutOptions: { 'elk.algorithm': 'layered' },
      children: [{ id: 'a', width: 40.3, height: 30.7 }],
      edges: [{ id: 'aa', sources: ['a'], targets: ['a'], labels: [{ text: 'loop', width: 24.6, height: 12.7 }] }],
    },
  },
  {
    name: 'activated partitions with collector edges and end labels',
    graph: {
      "id": "root",
      "layoutOptions": {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.partitioning.activate": "true",
        "elk.layered.mergeEdges": "true"
      },
      "children": [
        {
          "id": "a",
          "width": 31.2,
          "height": 23.7,
          "layoutOptions": {
            "elk.partitioning.partition": "-1"
          }
        },
        {
          "id": "b",
          "width": 42.3,
          "height": 34.8,
          "layoutOptions": {
            "elk.partitioning.partition": "0"
          }
        },
        {
          "id": "c",
          "width": 29.4,
          "height": 21.5,
          "layoutOptions": {
            "elk.partitioning.partition": "127"
          }
        },
        {
          "id": "d",
          "width": 36.7,
          "height": 26.8,
          "layoutOptions": {
            "elk.partitioning.partition": "129"
          }
        }
      ],
      "edges": [
        {
          "id": "ac",
          "sources": [
            "a"
          ],
          "targets": [
            "c"
          ]
        },
        {
          "id": "bc",
          "sources": [
            "b"
          ],
          "targets": [
            "c"
          ]
        },
        {
          "id": "cd",
          "sources": [
            "c"
          ],
          "targets": [
            "d"
          ]
        },
        {
          "id": "da",
          "sources": [
            "d"
          ],
          "targets": [
            "a"
          ]
        },
        {
          "id": "parallel",
          "sources": [
            "d"
          ],
          "targets": [
            "a"
          ],
          "layoutOptions": {
            "elk.layered.priority.direction": "2147483647"
          },
          "labels": [
            {
              "text": "head",
              "width": 12.3,
              "height": 4.7,
              "layoutOptions": {
                "elk.edgeLabels.placement": "HEAD"
              }
            },
            {
              "text": "tail",
              "width": 9.1,
              "height": 3.7,
              "layoutOptions": {
                "elk.edgeLabels.placement": "TAIL"
              }
            }
          ]
        }
      ]
    },
  },
  {
    name: 'nested groups and a cross-hierarchy label',
    graph: {
      id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.direction': 'DOWN' },
      children: [{ id: 'g', children: [{ id: 'ga', width: 32.3, height: 21.7 }, { id: 'gb', width: 43.1, height: 32.9 }], edges: [{ id: 'gab', sources: ['ga'], targets: ['gb'] }] }, { id: 'other', width: 35.6, height: 25.4 }],
      edges: [{ id: 'go', sources: ['gb'], targets: ['other'], labels: [{ text: 'cross', width: 34.6, height: 11.3 }] }],
    },
  },
  {
    name: 'ancestor endpoint with distinct parent and content padding',
    graph: {
      "id": "root",
      "layoutOptions": {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.spacing.nodeNode": "28",
        "elk.layered.spacing.nodeNodeBetweenLayers": "48",
        "elk.spacing.edgeEdge": "12",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
        "elk.layered.spacing.edgeNodeBetweenLayers": "12.375",
        "elk.padding": "[top=40,left=40,bottom=40,right=40]",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
        "elk.contentAlignment": "H_CENTER V_CENTER",
        "elk.layered.thoroughness": "3",
        "elk.layered.highDegreeNodes.treatment": "true",
        "elk.layered.highDegreeNodes.threshold": "8",
        "elk.layered.compaction.postCompaction.strategy": "LEFT_RIGHT_CONSTRAINT_LOCKING",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
        "elk.layered.feedbackEdges": "true",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        "elk.layered.wrapping.strategy": "OFF",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN"
      },
      "children": [
        {
          "id": "G",
          "layoutOptions": {
            "elk.algorithm": "layered",
            "elk.padding": "[top=44,left=16,bottom=16,right=16]",
            "elk.edgeRouting": "ORTHOGONAL",
            "elk.contentAlignment": "H_CENTER V_CENTER",
            "elk.spacing.edgeEdge": "12",
            "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
            "elk.layered.spacing.edgeNodeBetweenLayers": "12.375",
            "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
            "elk.layered.spacing.nodeNodeBetweenLayers": "48",
            "elk.spacing.nodeNode": "28"
          },
          "labels": [
            {
              "text": "G"
            }
          ],
          "children": [
            {
              "id": "a",
              "width": 60,
              "height": 36.900000000000006,
              "labels": [
                {
                  "text": "a"
                }
              ]
            },
            {
              "id": "b",
              "width": 60,
              "height": 36.900000000000006,
              "labels": [
                {
                  "text": "b"
                }
              ]
            }
          ],
          "edges": []
        }
      ],
      "edges": [
        {
          "id": "e0",
          "sources": [
            "G"
          ],
          "targets": [
            "a"
          ]
        }
      ]
    },
  },
  {
    name: 'ancestor endpoint above nested groups',
    graph: {
      "id": "root",
      "layoutOptions": {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.spacing.nodeNode": "28",
        "elk.layered.spacing.nodeNodeBetweenLayers": "48",
        "elk.spacing.edgeEdge": "12",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
        "elk.layered.spacing.edgeNodeBetweenLayers": "12.375",
        "elk.padding": "[top=40,left=40,bottom=40,right=40]",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
        "elk.contentAlignment": "H_CENTER V_CENTER",
        "elk.layered.thoroughness": "3",
        "elk.layered.highDegreeNodes.treatment": "true",
        "elk.layered.highDegreeNodes.threshold": "8",
        "elk.layered.compaction.postCompaction.strategy": "LEFT_RIGHT_CONSTRAINT_LOCKING",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
        "elk.layered.feedbackEdges": "true",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        "elk.layered.wrapping.strategy": "OFF",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN"
      },
      "children": [
        {
          "id": "Outer",
          "layoutOptions": {
            "elk.algorithm": "layered",
            "elk.padding": "[top=44,left=16,bottom=16,right=16]",
            "elk.edgeRouting": "ORTHOGONAL",
            "elk.contentAlignment": "H_CENTER V_CENTER",
            "elk.spacing.edgeEdge": "12",
            "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
            "elk.layered.spacing.edgeNodeBetweenLayers": "12.375",
            "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
            "elk.layered.spacing.nodeNodeBetweenLayers": "48",
            "elk.spacing.nodeNode": "28"
          },
          "labels": [
            {
              "text": "Outer"
            }
          ],
          "children": [
            {
              "id": "Inner",
              "layoutOptions": {
                "elk.algorithm": "layered",
                "elk.padding": "[top=44,left=16,bottom=16,right=16]",
                "elk.edgeRouting": "ORTHOGONAL",
                "elk.contentAlignment": "H_CENTER V_CENTER",
                "elk.spacing.edgeEdge": "12",
                "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
                "elk.layered.spacing.edgeNodeBetweenLayers": "12.375",
                "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
                "elk.layered.spacing.nodeNodeBetweenLayers": "48",
                "elk.spacing.nodeNode": "28"
              },
              "labels": [
                {
                  "text": "Inner"
                }
              ],
              "children": [
                {
                  "id": "x",
                  "width": 60,
                  "height": 36.900000000000006,
                  "labels": [
                    {
                      "text": "x"
                    }
                  ]
                }
              ],
              "edges": []
            }
          ],
          "edges": []
        }
      ],
      "edges": [
        {
          "id": "e0",
          "sources": [
            "Outer"
          ],
          "targets": [
            "Inner"
          ]
        }
      ]
    },
  },
]

test('elk-instance matches the dev-only elkjs oracle exactly', () => {
  // Isolate both solver module lifetimes from the rest of the unit suite.
  const source = `
    process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
    const { deepStrictEqual } = await import('node:assert/strict')
    const { elkLayoutSync } = await import(${JSON.stringify(new URL('../elk-instance.ts', import.meta.url).href)})
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
    const { withoutGeneratedIdentity } = await import(${JSON.stringify(new URL('../../eval/elk-layered/comparison.ts', import.meta.url).href)})
    // Select elkjs's CJS worker path under Bun's browser-like global self.
    const document = globalThis.document
    let oracle
    try { globalThis.document = {}; oracle = new ELK() } finally { if (document === undefined) delete globalThis.document; else globalThis.document = document }
    for (const row of ${JSON.stringify(cases)}) {
      const expected = await oracle.layout(structuredClone(row.graph))
      const actual = elkLayoutSync(structuredClone(row.graph))
      deepStrictEqual(withoutGeneratedIdentity(actual, row.graph), withoutGeneratedIdentity(expected, row.graph), row.name)
    }
  `
  const child = Bun.spawnSync([process.execPath, '--eval', source], { cwd: new URL('../..', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString() + child.stdout.toString())
})
