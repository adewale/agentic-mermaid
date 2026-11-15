/* SPDX-License-Identifier: EPL-2.0 */
import type { EStructuralFeature } from './EStructuralFeature.ts'
import type { EPackage } from './EPackage.ts'
import type { EClassifier } from './EClassifier.ts'

export interface EClass extends EClassifier { getClassifierID(): number; getFeatureID(feature: EStructuralFeature): number; getName(): string | null; getEPackage(): EPackage; getEStructuralFeature(featureID: number): EStructuralFeature | null }
