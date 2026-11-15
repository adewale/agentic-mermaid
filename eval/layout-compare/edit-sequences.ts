import type { RenderOptions } from '../../src/types.ts'

export interface EditStep { name: string; source: string; affected: string[]; options?: Pick<RenderOptions, 'layoutHints'> }
export interface EditSequence { family: string; base: string; steps: EditStep[] }

/** Declared edit populations. Sets identify directly edited subjects, not a
 * retrospectively enlarged neighborhood. Every run also reports whole-graph
 * motion. These are deterministic diagnostics, not an incremental API. */
export function editSequences(): EditSequence[] {
  const flow = 'flowchart TD\nAPI[API] -->|reads| DB[Database]\nDB --> Log[Log]\nAPI --> Cache[Cache]'
  const state = 'stateDiagram-v2\ndirection TB\n[*] --> Idle\nIdle --> Running : start\nRunning --> Done : finish\nDone --> [*]'
  const classes = 'classDiagram\ndirection TB\nnamespace Domain {\n class Account {\n +String id\n }\n class Store {\n +fetch()\n }\n Account --> Store : loads\n}\nclass Audit\nStore --> Audit : records'
  const er = 'erDiagram\ndirection LR\nACCOUNT {\n int id PK\n}\nORDER {\n int id PK\n int account_id FK\n}\nAUDIT {\n int id PK\n}\nACCOUNT ||--o{ ORDER : places\nORDER ||..o{ AUDIT : records'
  const requirement = 'requirementDiagram\ndirection TB\nrequirement speed {\nid: R1\ntext: "Fast response"\nrisk: high\nverifymethod: test\n}\nelement suite {\ntype: "test"\n}\nsuite - verifies -> speed'
  const architecture = 'architecture-beta\ngroup api(cloud)[API]\nservice web(server)[Web] in api\nservice db(database)[Database] in api\nservice audit(disk)[Audit]\nweb:R --> L:db\ndb:B --> T:audit'
  const sequence = (family: string, base: string, steps: EditStep[]): EditSequence => ({ family, base, steps: [...steps, { name: 'undo', source: base, affected: [] }] })
  return [
    sequence('flowchart', flow, [
      { name: 'rename', source: flow.replace('[API]', '[Gateway]'), affected: ['API'] },
      { name: 'label-growth', source: flow.replace('[Database]', '[Long durable customer database]'), affected: ['DB'] },
      { name: 'add-node-edge', source: `${flow}\nDB --> Queue[Queue]`, affected: ['DB', 'Queue'] },
      { name: 'remove-node-edge', source: flow.replace('\nAPI --> Cache[Cache]', ''), affected: ['API', 'Cache'] },
      { name: 'introduce-cycle', source: `${flow}\nLog --> API`, affected: ['Log', 'API'] },
      { name: 'change-shape', source: flow.replace('DB[Database]', 'DB{Database}'), affected: ['DB'] },
      { name: 'change-direction', source: flow.replace('TD', 'LR'), affected: [] },
      { name: 'move-membership', source: `${flow}\nsubgraph Storage\nDB\nend`, affected: ['DB'] },
      { name: 'eligibility-layout-hint', source: flow, affected: [], options: { layoutHints: { ranks: { API: 0, DB: 1 } } } },
    ]),
    sequence('state', state, [
      { name: 'label-growth', source: `${state}\nstate "Waiting for the next request" as Idle`, affected: ['Idle'] },
      { name: 'introduce-cycle', source: `${state}\nRunning --> Idle : retry`, affected: ['Running', 'Idle'] },
      { name: 'change-direction', source: state.replace('TB', 'LR'), affected: [] },
      { name: 'move-membership', source: 'stateDiagram-v2\nstate Parent {\n Idle --> Running : start\n}\nRunning --> Done : finish', affected: ['Idle', 'Running'] },
    ]),
    sequence('class', classes, [
      { name: 'member-growth', source: classes.replace('+String id', '+String id\n +String durableCustomerIdentifier\n + save(String key)'), affected: ['Account'] },
      { name: 'introduce-cycle', source: `${classes}\nAudit --> Account : reviews`, affected: ['Audit', 'Account'] },
      { name: 'change-direction', source: classes.replace('TB', 'LR'), affected: [] },
      { name: 'add-node-edge', source: `${classes}\nclass Queue\nStore --> Queue : schedules`, affected: ['Store', 'Queue'] },
    ]),
    sequence('er', er, [
      { name: 'attribute-growth', source: er.replace('int account_id FK', 'int account_id FK\n string durableCustomerIdentifier'), affected: ['ORDER'] },
      { name: 'introduce-cycle', source: `${er}\nAUDIT ||..o{ ACCOUNT : reviews`, affected: ['AUDIT', 'ACCOUNT'] },
      { name: 'change-direction', source: er.replace('LR', 'TB'), affected: [] },
    ]),
    sequence('requirement', requirement, [
      { name: 'text-growth', source: requirement.replace('Fast response', 'Retain a bounded response time for every customer request'), affected: ['speed'] },
      { name: 'introduce-cycle', source: `${requirement}\nspeed - derives -> suite`, affected: ['speed', 'suite'] },
      { name: 'change-direction', source: requirement.replace('TB', 'LR'), affected: [] },
    ]),
    sequence('architecture', architecture, [
      { name: 'label-growth', source: architecture.replace('[Database]', '[Durable customer database]'), affected: ['db'] },
      { name: 'change-port', source: architecture.replace('web:R --> L:db', 'web:B --> T:db'), affected: ['web', 'db'] },
      { name: 'align-row', source: `${architecture}\nalign row web db`, affected: ['web', 'db'] },
      { name: 'move-membership', source: architecture.replace('service audit(disk)[Audit]', 'service audit(disk)[Audit] in api'), affected: ['audit'] },
    ]),
  ]
}
