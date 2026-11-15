/* SPDX-License-Identifier: EPL-2.0 */
import type { EStructuralFeature } from './EStructuralFeature.ts'
export interface EReference extends EStructuralFeature { getEOpposite(): EReference | null; isContainment(): boolean }
