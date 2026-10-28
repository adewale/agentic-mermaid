import { PELE_SEMANTIC_ADAPTER } from './pele-semantics.ts'

/** Admission is tied to the actual installed peer, version and fetched bytes. */
export function selectedPeerSemanticAdapter(pin: { peer: string; version: string; integrity?: string }) {
  return pin.peer === PELE_SEMANTIC_ADAPTER.peer && pin.version === PELE_SEMANTIC_ADAPTER.version && pin.integrity === PELE_SEMANTIC_ADAPTER.integrity ? PELE_SEMANTIC_ADAPTER.id : undefined
}
