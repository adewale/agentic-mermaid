/* SPDX-License-Identifier: EPL-2.0 */
import type { Class } from '../../../../java/lang/Class.ts'
import type { EPackage } from './EPackage.ts'

export interface EClassifier { getName(): string | null; getClassifierID(): number; getEPackage(): EPackage; getInstanceClass(): Class<unknown> }
