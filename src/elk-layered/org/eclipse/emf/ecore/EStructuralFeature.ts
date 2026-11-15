/* SPDX-License-Identifier: EPL-2.0 */
import type { Class } from '../../../../java/lang/Class.ts'

import type { EClassifier } from './EClassifier.ts'

export interface EStructuralFeature { getFeatureID(): number; getEType(): EClassifier; getName(): string | null; getContainerClass(): Class<unknown>; getDefaultValue(): unknown; isUnsettable(): boolean }
