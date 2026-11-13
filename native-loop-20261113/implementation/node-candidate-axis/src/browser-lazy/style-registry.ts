import { DeferredDependencyError } from '../layout/certification-error.ts'
import type * as Registry from '../scene/style-registry.ts'

// Module-loader state only; all style data and admission remain canonical.
let runtime: typeof import('./style-runtime.ts') | undefined
async function load(): Promise<void> { runtime ??= await import('./style-runtime.ts') }
function styles(): NonNullable<typeof runtime> {
  if (!runtime) throw new DeferredDependencyError('Styles', load)
  return runtime
}

/** Undefined style has no registry lookup, validation or private face. */
export function resolveStyleStackWithFace(...args: Parameters<typeof Registry.resolveStyleStackWithFace>): ReturnType<typeof Registry.resolveStyleStackWithFace> {
  return args[0] === undefined ? {} : styles().resolveStyleStackWithFace(...args)
}
export function resolveStyleStack(...args: Parameters<typeof Registry.resolveStyleStack>): ReturnType<typeof Registry.resolveStyleStack> {
  return args[0] === undefined ? undefined : styles().resolveStyleStack(...args)
}
export function styleRegistryRevision(): number { return runtime?.styleRegistryRevision() ?? 0 }
export function resolveStyleReference(...args: Parameters<typeof Registry.resolveStyleReference>): ReturnType<typeof Registry.resolveStyleReference> { return styles().resolveStyleReference(...args) }
export function inferBackend(...args: Parameters<typeof Registry.inferBackend>): ReturnType<typeof Registry.inferBackend> { return styles().inferBackend(...args) }
export function isStyledSpec(...args: Parameters<typeof Registry.isStyledSpec>): ReturnType<typeof Registry.isStyledSpec> { return styles().isStyledSpec(...args) }
export { resolveRoleStyle } from '../scene/roles.ts'
export type * from '../scene/style-registry.ts'

export function styleOptionValidationRoot() { return styles().STYLE_OPTION_VALIDATION_ROOT }
