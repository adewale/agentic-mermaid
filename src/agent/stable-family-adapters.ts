// Public SDK adapters add mutation to the same source operations used by workers.
import type { FamilyOperations } from './family-registry.ts'
import type { MutationError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { AccessibilityTextError, normalizeBodyAccessibility } from './accessibility-envelope.ts'
import { PACKET_SOURCE_ADAPTER, PACKET_SOURCE_HOOKS, KANBAN_SOURCE_ADAPTER, KANBAN_SOURCE_HOOKS, REQUIREMENT_SOURCE_ADAPTER, REQUIREMENT_SOURCE_HOOKS, BLOCK_SOURCE_ADAPTER, BLOCK_SOURCE_HOOKS, TREEMAP_SOURCE_ADAPTER, TREEMAP_SOURCE_HOOKS, ISHIKAWA_SOURCE_ADAPTER, ISHIKAWA_SOURCE_HOOKS } from './stable-family-source-hooks.ts'
import type { StableBody } from './stable-family-source-hooks.ts'
export type { StableBody } from './stable-family-source-hooks.ts'
export { isStableFamilyBody, stableFamilyTree, stableFamilyCount, stableFamilyFacts, stableFamilyLabels } from './stable-family-source-hooks.ts'
import { mutateBlock } from './block-body.ts'
import { mutateIshikawa } from './ishikawa-body.ts'
import { mutateKanban } from './kanban-body.ts'
import { mutatePacket } from './packet-body.ts'
import { mutateRequirement } from './requirement-body.ts'
import { mutateTreemap } from './treemap-body.ts'

function mutation<K extends StableBody['kind']>(kind: K, adapter: { readSource: (source: string) => Extract<StableBody, { kind: K }> | null; serialize: (body: Extract<StableBody, { kind: K }>) => string }, mutate: (body: Extract<StableBody, { kind: K }>, op: never) => Result<Extract<StableBody, { kind: K }>, MutationError>): NonNullable<FamilyOperations['mutate']> {
  const { readSource, serialize } = adapter
  return (body, op) => {
    if (body.kind !== kind) return err({ code: 'UNSUPPORTED_FAMILY', message: `${kind} contains unmodeled syntax and remains preserved verbatim` })
    const changed = mutate(body as Extract<StableBody, { kind: K }>, op as never)
    if (!changed.ok) return changed
    try { changed.value = normalizeBodyAccessibility(changed.value) }
    catch (error) {
      if (!(error instanceof AccessibilityTextError)) throw error
      return err({ code: 'INVALID_OP', message: error.message })
    }
    // Generated occurrence IDs belong to the resulting source artifact.
    // Publish the same identities/order that its renderer and source map see.
    const normalized = readSource(serialize(changed.value))
    if (normalized && (changed.value.accessibilityTitle !== normalized.accessibilityTitle
      || changed.value.accessibilityDescription !== normalized.accessibilityDescription)) {
      return err({ code: 'INVALID_OP', message: `${kind} accessibility text cannot be serialized without changing its value` })
    }
    return normalized ? ok(normalized) : err({ code: 'INVALID_OP', message: `${kind} edit could not preserve its structured representation` })
  }
}

export const PACKET_AGENT_HOOKS = { ...PACKET_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('packet', PACKET_SOURCE_ADAPTER, mutatePacket) } satisfies FamilyOperations

export const KANBAN_AGENT_HOOKS = { ...KANBAN_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('kanban', KANBAN_SOURCE_ADAPTER, mutateKanban) } satisfies FamilyOperations

export const REQUIREMENT_AGENT_HOOKS = { ...REQUIREMENT_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('requirement', REQUIREMENT_SOURCE_ADAPTER, mutateRequirement) } satisfies FamilyOperations

export const BLOCK_AGENT_HOOKS = { ...BLOCK_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('block', BLOCK_SOURCE_ADAPTER, mutateBlock) } satisfies FamilyOperations

export const TREEMAP_AGENT_HOOKS = { ...TREEMAP_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('treemap', TREEMAP_SOURCE_ADAPTER, mutateTreemap) } satisfies FamilyOperations

export const ISHIKAWA_AGENT_HOOKS = { ...ISHIKAWA_SOURCE_HOOKS, mutate: /* @__PURE__ */ mutation('ishikawa', ISHIKAWA_SOURCE_ADAPTER, mutateIshikawa) } satisfies FamilyOperations

export const STABLE_FAMILY_AGENT_HOOKS = {
  packet: PACKET_AGENT_HOOKS,
  kanban: KANBAN_AGENT_HOOKS,
  requirement: REQUIREMENT_AGENT_HOOKS,
  block: BLOCK_AGENT_HOOKS,
  treemap: TREEMAP_AGENT_HOOKS,
  ishikawa: ISHIKAWA_AGENT_HOOKS,
}
