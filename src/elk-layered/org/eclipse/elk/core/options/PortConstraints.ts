/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'

export class PortConstraints extends Enum<PortConstraints> {
  static readonly UNDEFINED = new PortConstraints('UNDEFINED', 0)
  static readonly FREE = new PortConstraints('FREE', 1)
  static readonly FIXED_SIDE = new PortConstraints('FIXED_SIDE', 2)
  static readonly FIXED_ORDER = new PortConstraints('FIXED_ORDER', 3)
  static readonly FIXED_RATIO = new PortConstraints('FIXED_RATIO', 4)
  static readonly FIXED_POS = new PortConstraints('FIXED_POS', 5)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): PortConstraints[] { return [PortConstraints.UNDEFINED, PortConstraints.FREE, PortConstraints.FIXED_SIDE, PortConstraints.FIXED_ORDER, PortConstraints.FIXED_RATIO, PortConstraints.FIXED_POS] }
  static valueOf(name: string): PortConstraints { for (const value of PortConstraints.values()) if (value.name() === name) return value; throw new Error(`Unknown PortConstraints value: ${name}`) }
  isPosFixed(): boolean { return this === PortConstraints.FIXED_POS }
  isRatioFixed(): boolean { return this === PortConstraints.FIXED_RATIO }
  isOrderFixed(): boolean { return this === PortConstraints.FIXED_ORDER || this === PortConstraints.FIXED_RATIO || this === PortConstraints.FIXED_POS }
  isSideFixed(): boolean { return this !== PortConstraints.FREE && this !== PortConstraints.UNDEFINED }
}
