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

export class InLayerConstraint extends Enum<InLayerConstraint> {
  static readonly NONE = new InLayerConstraint('NONE', 0)
  static readonly TOP = new InLayerConstraint('TOP', 1)
  static readonly BOTTOM = new InLayerConstraint('BOTTOM', 2)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): InLayerConstraint[] { return [InLayerConstraint.NONE, InLayerConstraint.TOP, InLayerConstraint.BOTTOM] }
  static valueOf(name: string): InLayerConstraint {
    for (const value of InLayerConstraint.values()) if (value.name() === name) return value
    throw new Error(`Unknown InLayerConstraint value: ${name}`)
  }
}
