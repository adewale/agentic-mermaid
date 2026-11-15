/* SPDX-License-Identifier: EPL-2.0 */
import type { EClass } from './EClass.ts'
import type { EObject } from './EObject.ts'
export interface EFactory { create(eClass: EClass): EObject }
