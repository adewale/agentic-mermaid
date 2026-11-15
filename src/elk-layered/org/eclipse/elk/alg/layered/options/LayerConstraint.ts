/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../../java/lang/Enum.ts'

export class LayerConstraint extends Enum<LayerConstraint> {
  static readonly NONE = new LayerConstraint('NONE', 0)
  static readonly FIRST = new LayerConstraint('FIRST', 1)
  static readonly FIRST_SEPARATE = new LayerConstraint('FIRST_SEPARATE', 2)
  static readonly LAST = new LayerConstraint('LAST', 3)
  static readonly LAST_SEPARATE = new LayerConstraint('LAST_SEPARATE', 4)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): LayerConstraint[] { return [LayerConstraint.NONE, LayerConstraint.FIRST, LayerConstraint.FIRST_SEPARATE, LayerConstraint.LAST, LayerConstraint.LAST_SEPARATE] }
  static valueOf(name: string): LayerConstraint {
    for (const value of LayerConstraint.values()) if (value.name() === name) return value
    throw new Error(`Unknown LayerConstraint value: ${name}`)
  }
}
