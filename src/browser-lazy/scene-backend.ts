import { DeferredDependencyError } from '../layout/certification-error.ts'
import type * as Backend from '../scene/backend.ts'

// Module acquisition only: there is no stand-in backend or conformance report.
let runtime: typeof import('./scene-backend-runtime.ts') | undefined
export let DefaultBackend: Backend.StyleBackend
export async function loadSceneBackend(): Promise<void> {
  runtime ??= await import('./scene-backend-runtime.ts')
  DefaultBackend = runtime.DefaultBackend
}
function spi(): NonNullable<typeof runtime> {
  if (!runtime) throw new DeferredDependencyError('Scene backend', loadSceneBackend)
  return runtime
}
export function getBackendDescriptor(...args: Parameters<typeof Backend.getBackendDescriptor>): ReturnType<typeof Backend.getBackendDescriptor> { return spi().getBackendDescriptor(...args) }
export function isBuiltinDefaultBackend(backend: Backend.StyleBackend): boolean { return runtime?.isBuiltinDefaultBackend(backend) ?? false }
export function isOriginalEnrolledDefaultBackend(backend: unknown): boolean { return runtime?.isOriginalEnrolledDefaultBackend(backend) ?? false }
export function assertBackendConformance(...args: Parameters<typeof Backend.assertBackendConformance>): ReturnType<typeof Backend.assertBackendConformance> { return spi().assertBackendConformance(...args) }
export function registerBuiltInBackend(...args: Parameters<typeof Backend.registerBuiltInBackend>): ReturnType<typeof Backend.registerBuiltInBackend> { return spi().registerBuiltInBackend(...args) }
export function composeGroup(...args: Parameters<typeof Backend.composeGroup>): ReturnType<typeof Backend.composeGroup> { return spi().composeGroup(...args) }
export function capturedPart(...args: Parameters<typeof Backend.capturedPart>): ReturnType<typeof Backend.capturedPart> { return spi().capturedPart(...args) }
export { pageRectFor } from '../scene/drawing-page.ts'
export type * from '../scene/backend.ts'
