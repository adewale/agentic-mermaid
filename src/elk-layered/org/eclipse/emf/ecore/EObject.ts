/* SPDX-License-Identifier: EPL-2.0 */
import type { EClass } from './EClass.ts'
export interface EObject {
  eContainer(): EObject | null
  eClass(): EClass
  eIsProxy(): boolean
}
