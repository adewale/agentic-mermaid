import { PACKAGE_VERSION } from '../version.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { graphicalBackendCapabilityClaims } from './capabilities.ts'

/** Shared declared identity/operations, not an executable Scene conformance
 * result. Native drawing proves the actual requested write through its own
 * XML, paint, ownership and aggregate-budget consumers. */
export const DEFAULT_DRAWING_CAPABILITIES = graphicalBackendCapabilityClaims('backend:default', 'crisp')
export const DEFAULT_DRAWING_IDENTITY = createExtensionIdentity({
  id: 'backend:default', kind: 'backend', version: '1.0.0',
  compatibility: { core: PACKAGE_VERSION, scene: '^2.0.0' },
  provenance: { owner: 'agentic-mermaid', source: 'built-in', reference: 'src/scene/backend.ts' },
})

export const FIRST_PARTY_DRAWING_CONSUMER = Object.freeze({
  kind: 'native-drawing' as const,
  identity: DEFAULT_DRAWING_IDENTITY,
  inputName: 'default' as const,
  capabilities: DEFAULT_DRAWING_CAPABILITIES,
})
export type FirstPartyDrawingConsumer = typeof FIRST_PARTY_DRAWING_CONSUMER
