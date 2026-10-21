/** Build-only twin: ordinary native drawing never needs retained Scene admission. */
import { DeferredDependencyError } from '../layout/certification-error.ts'
import type { admitFamilyScene as AdmitFamilyScene } from './admission-core.ts'

let admit: typeof AdmitFamilyScene | undefined

async function load(): Promise<void> {
  // Native import deduplicates concurrent demand. Cache only successful loads
  // so a failed transfer cannot mark the admission gate as ready.
  admit = (await import('./admission-core.ts')).admitFamilyScene
}

export const admitFamilyScene: typeof AdmitFamilyScene = (...args) => {
  if (!admit) throw new DeferredDependencyError('Scene admission', load)
  return admit(...args)
}
