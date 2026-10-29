import { ZENUML_SOURCE_HOOKS } from './zenuml-body.ts'
import { EVENTMODELING_SOURCE_HOOKS } from './eventmodeling-body.ts'
import { mutateZenUML } from '../zenuml/native-body.ts'
import type { ZenUMLMutationOp } from '../zenuml/native-types.ts'
import { mutateEventModeling } from '../eventmodeling/body.ts'
// Complete SDK hooks compose the shared source operations with mutation.
// Private source-only workers import families-source-hooks.ts directly.
import type { FamilyOperations } from './family-registry.ts'
import type { DiagramBody, DiagramKind, MutationError, Result } from './types.ts'
import { err } from './types.ts'
import { STABLE_FAMILY_AGENT_HOOKS } from './stable-family-adapters.ts'
import { FLOWCHART_SOURCE_HOOKS, STATE_SOURCE_HOOKS, SEQUENCE_SOURCE_HOOKS, TIMELINE_SOURCE_HOOKS, CLASS_SOURCE_HOOKS, ER_SOURCE_HOOKS, JOURNEY_SOURCE_HOOKS, XYCHART_SOURCE_HOOKS, PIE_SOURCE_HOOKS, QUADRANT_SOURCE_HOOKS, GANTT_SOURCE_HOOKS, ARCHITECTURE_SOURCE_HOOKS, MINDMAP_SOURCE_HOOKS, GITGRAPH_SOURCE_HOOKS, RADAR_SOURCE_HOOKS, SANKEY_SOURCE_HOOKS, C4_SOURCE_HOOKS } from './families-source-hooks.ts'
import { mutateC4 } from './c4-body.ts'
import { withMutationDraft } from './mutation-draft.ts'
import { mutateArchitecture } from './architecture-body.ts'
import { mutateClass, mutateClassSource } from './class-body.ts'
import { mutateEr } from './er-body.ts'
import { createFlowchartMutationDraft, mutateFlowchart, mutateFlowchartSource } from './flowchart-body.ts'
import { mutateGantt } from './gantt-body.ts'
import { mutateGitGraph } from './gitgraph-body.ts'
import { mutateJourney } from './journey-body.ts'
import { mutateMindmap } from './mindmap-body.ts'
import { mutatePie } from './pie-body.ts'
import { mutateQuadrant } from './quadrant-body.ts'
import { mutateRadar } from './radar-body.ts'
import { mutateSankey } from './sankey-body.ts'
import { createSequenceMutationDraft, mutateSequence } from './sequence-body.ts'
import { mutateState } from './state-body.ts'
import { mutateTimeline } from './timeline-body.ts'
import { mutateXyChart } from './xychart-body.ts'

function structuredMutation<K extends DiagramBody['kind'] & DiagramKind>(kind: K, mutate: (body: Extract<DiagramBody, { kind: K }>, op: never) => Result<Extract<DiagramBody, { kind: K }>, MutationError>): NonNullable<FamilyOperations['mutate']> {
  return (body, op) => {
    if (body.kind !== kind) return err<MutationError>({ code: 'INVALID_OP', message: `${kind} mutator received body kind ${body.kind}` })
    return mutate(body as Extract<DiagramBody, { kind: K }>, op as never)
  }
}

export const FLOWCHART_AGENT_HOOKS = {
  ...FLOWCHART_SOURCE_HOOKS,
  mutateSource: (source, op) => mutateFlowchartSource(source, op as never),
  mutate: withMutationDraft((body, op) => {
    if (body.kind !== 'flowchart') return err<MutationError>({ code: 'INVALID_OP', message: `flowchart mutator received body kind ${body.kind}` })
    return mutateFlowchart(body, op as never)
  }, body => {
    if (body.kind !== 'flowchart') return undefined
    const apply = createFlowchartMutationDraft(body)
    return op => apply(op as never)
  }),
} satisfies FamilyOperations

export const STATE_AGENT_HOOKS = {
  ...STATE_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('state', mutateState),
} satisfies FamilyOperations

export const SEQUENCE_AGENT_HOOKS = {
  ...SEQUENCE_SOURCE_HOOKS,
  mutate: withMutationDraft((body, op) => {
    if (body.kind !== 'sequence') return err<MutationError>({ code: 'INVALID_OP', message: `sequence mutator received body kind ${body.kind}` })
    return mutateSequence(body, op as never)
  }, body => {
    if (body.kind !== 'sequence') return undefined
    const apply = createSequenceMutationDraft(body)
    return op => apply(op as never)
  }),
} satisfies FamilyOperations

export const TIMELINE_AGENT_HOOKS = {
  ...TIMELINE_SOURCE_HOOKS,
  mutate: (body, op) => {
    if (body.kind !== 'timeline') return err<MutationError>({ code: 'INVALID_OP', message: `timeline mutator received body kind ${body.kind}` })
    return mutateTimeline(body, op as never)
  },
} satisfies FamilyOperations

export const CLASS_AGENT_HOOKS = {
  ...CLASS_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('class', mutateClass),
  mutateSource: (source, op) => mutateClassSource(source, op as never),
} satisfies FamilyOperations

export const ER_AGENT_HOOKS = {
  ...ER_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('er', mutateEr),
} satisfies FamilyOperations

export const JOURNEY_AGENT_HOOKS = {
  ...JOURNEY_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('journey', mutateJourney),
} satisfies FamilyOperations

export const XYCHART_AGENT_HOOKS = {
  ...XYCHART_SOURCE_HOOKS,
  mutate: (body, op) => {
    if (body.kind !== 'xychart') return err<MutationError>({ code: 'INVALID_OP', message: `xychart mutator received body kind ${body.kind}` })
    return mutateXyChart(body, op as never)
  },
} satisfies FamilyOperations

export const PIE_AGENT_HOOKS = {
  ...PIE_SOURCE_HOOKS,
  mutate: (body, op) => {
    if (body.kind !== 'pie') return err<MutationError>({ code: 'INVALID_OP', message: `pie mutator received body kind ${body.kind}` })
    return mutatePie(body, op as never)
  },
} satisfies FamilyOperations

export const QUADRANT_AGENT_HOOKS = {
  ...QUADRANT_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('quadrant', mutateQuadrant),
} satisfies FamilyOperations

export const GANTT_AGENT_HOOKS = {
  ...GANTT_SOURCE_HOOKS,
  mutate: (body, op) => {
    if (body.kind !== 'gantt') return err<MutationError>({ code: 'INVALID_OP', message: `gantt mutator received body kind ${body.kind}` })
    return mutateGantt(body, op as never)
  },
} satisfies FamilyOperations

export const ARCHITECTURE_AGENT_HOOKS = {
  ...ARCHITECTURE_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('architecture', mutateArchitecture),
} satisfies FamilyOperations

export const MINDMAP_AGENT_HOOKS = {
  ...MINDMAP_SOURCE_HOOKS,
  mutate: (body, op) => (body.kind === 'mindmap' ? mutateMindmap(body, op as never) : err({ code: 'INVALID_OP', message: `mindmap mutator received body kind ${body.kind}` })),
} satisfies FamilyOperations

export const GITGRAPH_AGENT_HOOKS = {
  ...GITGRAPH_SOURCE_HOOKS,
  mutate: (body, op) => (body.kind === 'gitgraph' ? mutateGitGraph(body, op as never) : err({ code: 'INVALID_OP', message: `gitgraph mutator received body kind ${body.kind}` })),
} satisfies FamilyOperations

export const RADAR_AGENT_HOOKS = {
  ...RADAR_SOURCE_HOOKS,
  mutate: (body, op) => {
    if (body.kind !== 'radar') return err<MutationError>({ code: 'INVALID_OP', message: `radar mutator received body kind ${body.kind}` })
    return mutateRadar(body, op as never)
  },
} satisfies FamilyOperations

export const SANKEY_AGENT_HOOKS = {
  ...SANKEY_SOURCE_HOOKS,
  mutate: /* @__PURE__ */ structuredMutation('sankey', mutateSankey),
} satisfies FamilyOperations

export const C4_AGENT_HOOKS = {
  ...C4_SOURCE_HOOKS,
  mutate: (body, op) => (body.kind === 'c4' ? mutateC4(body, op as never) : err<MutationError>({ code: 'UNSUPPORTED_FAMILY', message: 'C4 source contains unmodeled syntax; preserve it verbatim or edit source explicitly.' })),
} satisfies FamilyOperations

export const EVENTMODELING_AGENT_HOOKS: FamilyOperations = {
  ...EVENTMODELING_SOURCE_HOOKS,
  mutate: (body, op) => (body.kind === 'eventmodeling' ? mutateEventModeling(body, op as never) : err({ code: 'UNSUPPORTED_FAMILY', message: 'Unmodeled Event Modeling source remains preserved' })),
}

export const ZENUML_AGENT_HOOKS: FamilyOperations = {
  ...ZENUML_SOURCE_HOOKS,
  mutate: (body, op) => body.kind === 'zenuml'
    ? mutateZenUML(body, op as ZenUMLMutationOp)
    : err({ code: 'UNSUPPORTED_FAMILY', message: 'Unmodeled ZenUML source remains preserved.' }),
}

export const BUILTIN_AGENT_HOOKS = /* @__PURE__ */ Object.freeze({
  flowchart: FLOWCHART_AGENT_HOOKS,
  state: STATE_AGENT_HOOKS,
  sequence: SEQUENCE_AGENT_HOOKS,
  timeline: TIMELINE_AGENT_HOOKS,
  class: CLASS_AGENT_HOOKS,
  er: ER_AGENT_HOOKS,
  journey: JOURNEY_AGENT_HOOKS,
  xychart: XYCHART_AGENT_HOOKS,
  pie: PIE_AGENT_HOOKS,
  quadrant: QUADRANT_AGENT_HOOKS,
  gantt: GANTT_AGENT_HOOKS,
  architecture: ARCHITECTURE_AGENT_HOOKS,
  mindmap: MINDMAP_AGENT_HOOKS,
  gitgraph: GITGRAPH_AGENT_HOOKS,
  radar: RADAR_AGENT_HOOKS,
  sankey: SANKEY_AGENT_HOOKS,
  c4: C4_AGENT_HOOKS,
  zenuml: ZENUML_AGENT_HOOKS,
  eventmodeling: EVENTMODELING_AGENT_HOOKS,
  ...STABLE_FAMILY_AGENT_HOOKS,
}) satisfies Readonly<Record<DiagramKind, FamilyOperations>>
