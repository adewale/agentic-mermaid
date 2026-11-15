/*******************************************************************************
 * Copyright (c) 2014, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { Property } from '../../graph/properties/Property.ts'

export class LabelSide extends Enum<LabelSide> {
  static readonly UNKNOWN = new LabelSide('UNKNOWN', 0)
  static readonly ABOVE = new LabelSide('ABOVE', 1)
  static readonly BELOW = new LabelSide('BELOW', 2)
  static readonly INLINE = new LabelSide('INLINE', 3)
  static readonly LABEL_SIDE = new Property('org.eclipse.elk.labelSide', LabelSide.UNKNOWN)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): LabelSide[] { return [LabelSide.UNKNOWN, LabelSide.ABOVE, LabelSide.BELOW, LabelSide.INLINE] }
  static valueOf(name: string): LabelSide { for (const value of LabelSide.values()) if (value.name() === name) return value; throw new Error(`Unknown LabelSide value: ${name}`) }
  opposite(): LabelSide {
    switch (this) {
      case LabelSide.ABOVE: return LabelSide.BELOW
      case LabelSide.BELOW: return LabelSide.ABOVE
      case LabelSide.INLINE: return LabelSide.INLINE
      default: return LabelSide.UNKNOWN
    }
  }
}
