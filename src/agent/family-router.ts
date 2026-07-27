// Runtime-neutral family detection seam.
//
// The complete built-in registry installs its resolver when `families.ts` is
// evaluated. Browser-lazy rendering supplies an already-loaded descriptor to
// the render contract instead, so source normalization and the common SVG core
// do not need to import every family hook merely to identify a header.

import type { FamilyDescriptor } from './families.ts'
import type { FamilyId } from './types.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

export type RegisteredFamilyResolver = (
  firstLine: string,
  mode?: 'strict' | 'loose',
) => FamilyDescriptor | null
export type RegisteredFamilyByIdResolver = (id: FamilyId | string) => FamilyDescriptor | undefined

let registeredFamilyResolver: RegisteredFamilyResolver | undefined
let registeredFamilyByIdResolver: RegisteredFamilyByIdResolver | undefined
const loadedFamilyDescriptors = new Map<FamilyId, FamilyDescriptor>()

export type CompatibilityGraphFamilyId = 'flowchart' | 'state'

export function normalizeFamilyDetectionLine(firstLine: string): string {
  return (firstLine.split(';')[0] ?? '').trim().toLowerCase()
}

/** Lightweight compatibility-parser ownership, deliberately independent of
 * the complete family registry so direct graph-parser imports remain usable. */
export function detectsFlowchartFamily(firstLine: string): boolean {
  // Keep this detector self-contained: the browser catalog generator embeds
  // descriptor detectors via Function#toString at build time.
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^(?:flowchart|graph|swimlane)(?:\s|$)/.test(line)
}

export function detectsStateFamily(firstLine: string): boolean {
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^statediagram(?:-v2)?\s*$/.test(line)
}

export function detectsStateFamilyLoose(firstLine: string): boolean {
  const line = (firstLine.split(';')[0] ?? '').trim().toLowerCase()
  return /^statediagram(?:-v2)?(?:\s|$)/.test(line)
}

export function detectCompatibilityGraphFamilyFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): CompatibilityGraphFamilyId | null {
  if (detectsFlowchartFamily(firstLine)) return 'flowchart'
  if (mode === 'loose' ? detectsStateFamilyLoose(firstLine) : detectsStateFamily(firstLine)) return 'state'
  return null
}

export function installRegisteredFamilyResolver(resolver: RegisteredFamilyResolver): void {
  registeredFamilyResolver = resolver
}

export function installRegisteredFamilyByIdResolver(resolver: RegisteredFamilyByIdResolver): void {
  registeredFamilyByIdResolver = resolver
}

/** Add one descriptor without importing the complete registry. This is
 * additive so concurrent async renders of different families cannot replace
 * one another's parser routing state. */
export function installLoadedFamilyDescriptor(descriptor: FamilyDescriptor): void {
  loadedFamilyDescriptors.set(descriptor.id, descriptor)
}

export function getInstalledFamilyDescriptor(id: FamilyId | string): FamilyDescriptor | undefined {
  return registeredFamilyByIdResolver?.(id) ?? loadedFamilyDescriptors.get(id as FamilyId)
}

export function detectInstalledFamilyDescriptorFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): FamilyDescriptor | null {
  const registered = registeredFamilyResolver?.(firstLine, mode)
  if (registered) return registered

  const line = normalizeFamilyDetectionLine(firstLine)
  const candidates = [...loadedFamilyDescriptors.values()].sort((a, b) =>
    b.collisionPriority - a.collisionPriority || compareCodePointStrings(a.id, b.id))
  return candidates.find(descriptor =>
    mode === 'loose'
      ? (descriptor.detectLoose ?? descriptor.detect)(line)
      : descriptor.detect(line)) ?? null
}

export function detectInstalledFamilyFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): FamilyId | null {
  return detectInstalledFamilyDescriptorFromFirstLine(firstLine, mode)?.id ?? null
}
