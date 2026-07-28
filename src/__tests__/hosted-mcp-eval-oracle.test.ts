import { expect, test } from 'bun:test'
import { gradeHostedMcpRequest } from '../../skill-evals/oracles/hosted-mcp-request.ts'

const stateSource = `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Complete: done
  Complete --> [*]`

function fenced(value: unknown): string {
  return `Proposed request:\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
}

test('hosted MCP eval oracle executes valid direct requests through production contracts', () => {
  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'verify',
        arguments: { source: 'flowchart TD\n  API --> DB' },
      }),
      { tool: 'verify', source: 'flowchart TD\n  API --> DB', family: 'flowchart' },
    ),
  ).toMatchObject({ ok: true, problems: [] })

  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'describe',
        arguments: { source: 'sequenceDiagram\n  Alice->>Bob: Hi', format: 'facts' },
      }),
      { tool: 'describe', source: 'sequenceDiagram\n  Alice->>Bob: Hi', format: 'facts' },
    ),
  ).toMatchObject({ ok: true, problems: [] })

  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'describe_sdk',
        arguments: { family: 'class', detail: 'fields' },
      }),
      { tool: 'describe_sdk', family: 'class', detail: 'fields' },
    ),
  ).toMatchObject({ ok: true, problems: [] })

  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'mutate',
        arguments: {
          source: stateSource,
          ops: [
            { kind: 'add_state', id: 'Failed', label: 'Failed' },
            { kind: 'add_transition', from: 'Processing', to: 'Failed', label: 'error' },
          ],
        },
      }),
      { tool: 'mutate', source: stateSource, family: 'state', resultContains: ['Failed', 'Processing --> Failed'] },
    ),
  ).toMatchObject({ ok: true, problems: [] })

  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'build',
        arguments: {
          family: 'class',
          ops: [
            { kind: 'add_class', id: 'Customer' },
            { kind: 'add_class', id: 'Account' },
            { kind: 'add_relation', from: 'Customer', to: 'Account', relKind: 'association', label: 'owns' },
          ],
        },
      }),
      { tool: 'build', family: 'class', classRelation: { from: 'Customer', to: 'Account', kind: 'association' } },
    ),
  ).toMatchObject({ ok: true, problems: [] })
})

test('hosted MCP eval oracle rejects transport mistakes and invented schemas', () => {
  expect(
    gradeHostedMcpRequest(
      fenced({
        jsonrpc: '2.0',
        id: 1,
        method: 'verify',
        params: { source: 'flowchart TD\nA-->B' },
      }),
      { tool: 'verify' },
    ).problems,
  ).toContain('final JSON request envelope must contain exactly tool and arguments')

  const invalid = gradeHostedMcpRequest(
    fenced({
      tool: 'build',
      arguments: { family: 'classDiagram', ops: [{ kind: 'add_node', id: 'A' }] },
    }),
    { tool: 'build', family: 'class' },
  )
  expect(invalid.ok).toBe(false)
  expect(invalid.problems.join('\n')).toContain('production mutation core rejected request')

  const wrongFormat = gradeHostedMcpRequest(
    fenced({
      tool: 'describe',
      arguments: { source: 'sequenceDiagram\n  Alice->>Bob: Hi', format: 'json' },
    }),
    { tool: 'describe', format: 'facts' },
  )
  expect(wrongFormat.problems).toContain('expected format facts')
})

test('hosted MCP eval oracle rejects wrong sources, incomplete outcomes, and underspecified discovery', () => {
  const wrongVerify = gradeHostedMcpRequest(
    fenced({
      tool: 'verify',
      arguments: { source: 'flowchart TD\n  X --> Y' },
    }),
    { tool: 'verify', source: 'flowchart TD\n  API --> DB', family: 'flowchart' },
  )
  expect(wrongVerify.problems).toContain('request source does not match the supplied fixture')

  const wrongDescribe = gradeHostedMcpRequest(
    fenced({
      tool: 'describe',
      arguments: { source: 'sequenceDiagram\n  X->>Y: Wrong', format: 'facts' },
    }),
    { tool: 'describe', source: 'sequenceDiagram\n  Alice->>Bob: Hi', format: 'facts' },
  )
  expect(wrongDescribe.problems).toContain('request source does not match the supplied fixture')

  const disconnectedBuild = gradeHostedMcpRequest(
    fenced({
      tool: 'build',
      arguments: {
        family: 'class',
        ops: [
          { kind: 'add_class', id: 'Customer' },
          { kind: 'add_class', id: 'Account' },
        ],
      },
    }),
    { tool: 'build', family: 'class', classRelation: { from: 'Customer', to: 'Account', kind: 'association' } },
  )
  expect(disconnectedBuild.problems).toContain('result class diagram lacks Customer -> Account association relation')

  const shallowDiscovery = gradeHostedMcpRequest(
    fenced({
      tool: 'describe_sdk',
      arguments: { family: 'class' },
    }),
    { tool: 'describe_sdk', family: 'class', detail: 'fields' },
  )
  expect(shallowDiscovery.problems).toContain('expected detail fields')
})

test('hosted MCP eval oracle requires one final fenced request and preserves source bytes', () => {
  const request = { tool: 'verify', arguments: { source: 'flowchart TD\n  API --> DB' } }
  expect(gradeHostedMcpRequest(`${fenced(request)}\ntrailing explanation`, { tool: 'verify' }).problems).toContain('the fenced JSON request envelope must be the final answer content')
  expect(gradeHostedMcpRequest(`${fenced(request)}\n${fenced(request)}`, { tool: 'verify' }).problems).toContain('expected exactly one fenced JSON request envelope, found 2')
  expect(
    gradeHostedMcpRequest(
      fenced({
        tool: 'verify',
        arguments: { source: 'flowchart TD\n  API --> DB' },
      }),
      { tool: 'verify', source: 'flowchart TD\n  API --> DB\n' },
    ).problems,
  ).toContain('request source does not match the supplied fixture')
})
