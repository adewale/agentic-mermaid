import {
  RENDER_TRANSPORT_SURFACES,
  SHARED_RENDER_OPTION_FIELDS,
  type RenderTransportSurface,
  type SharedRenderOptionField,
} from './render-contract.ts'
import { HOSTED_RENDER_OPTIONS } from './render-host-policy.ts'

export const SHARED_RENDER_OPTION_SURFACE_STATES = Object.freeze([
  'forwarded',
  'host-enforced',
  'unavailable',
] as const)

export type SharedRenderOptionSurfaceState = typeof SHARED_RENDER_OPTION_SURFACE_STATES[number]

export interface SharedRenderOptionSurfaceClaim {
  readonly state: SharedRenderOptionSurfaceState
  readonly enforcedValue?: string | number | boolean
  readonly reason?: string
}

export type SharedRenderOptionSurfaceClaims = Readonly<Record<
  RenderTransportSurface,
  SharedRenderOptionSurfaceClaim
>>

export const SHARED_RENDER_OPTION_SURFACE_EVIDENCE = Object.freeze({
  library: Object.freeze(['src/render-contract.ts', 'src/index.ts']),
  cli: Object.freeze(['src/cli/index.ts', 'src/__tests__/section-a-transport-parity.test.ts']),
  codeMode: Object.freeze(['src/mcp/facade.ts', 'src/mcp/sdk-decl.ts', 'src/__tests__/section-a-transport-parity.test.ts']),
  localMcp: Object.freeze(['src/mcp/server.ts', 'src/mcp/facade.ts', 'src/__tests__/section-a-transport-parity.test.ts']),
  hostedMcp: Object.freeze([
    'src/render-host-policy.ts',
    'src/mcp/hosted-server.ts',
    'src/mcp/harness-runtime.ts',
    'src/mcp/facade.ts',
    'src/__tests__/hosted-execute-differential.test.ts',
  ]),
  editor: Object.freeze(['editor/js/rendering.js', 'src/__tests__/editor-security-closures.test.ts']),
  website: Object.freeze(['website/src/rendering.ts', 'src/__tests__/website-render-receipts.test.ts']),
} as const satisfies Readonly<Record<RenderTransportSurface, readonly string[]>>)

const HOST_ENFORCED_FIELDS = Object.freeze({
  hostedMcp: Object.freeze(Object.keys(HOSTED_RENDER_OPTIONS) as SharedRenderOptionField[]),
  editor: Object.freeze(['security', 'embedFontImport'] as const satisfies readonly SharedRenderOptionField[]),
} as const)

function surfaceState(field: SharedRenderOptionField, surface: RenderTransportSurface): SharedRenderOptionSurfaceState {
  if (surface === 'hostedMcp' && HOST_ENFORCED_FIELDS.hostedMcp.includes(field)) return 'host-enforced'
  if (surface === 'editor' && HOST_ENFORCED_FIELDS.editor.includes(field as 'security' | 'embedFontImport')) return 'host-enforced'
  return 'forwarded'
}

function enforcedValue(field: SharedRenderOptionField): string | number | boolean | undefined {
  if (field !== 'security' && field !== 'embedFontImport') return undefined
  return HOSTED_RENDER_OPTIONS[field]
}

/**
 * Exhaustive shared-field × product-surface policy. The output matrix still
 * owns output availability/applicability; these cells say whether a meaningful
 * shared field is forwarded, constrained by the host, or unavailable.
 */
export const SHARED_RENDER_OPTION_SURFACE_CLAIMS = Object.freeze(Object.fromEntries(
  SHARED_RENDER_OPTION_FIELDS.map(field => [field, Object.freeze(Object.fromEntries(
    RENDER_TRANSPORT_SURFACES.map(surface => {
      const state = surfaceState(field, surface)
      return [surface, Object.freeze({
        state,
        ...(state === 'host-enforced' ? { enforcedValue: enforcedValue(field)! } : {}),
      })]
    }),
  ))]),
)) as Readonly<Record<SharedRenderOptionField, SharedRenderOptionSurfaceClaims>>
