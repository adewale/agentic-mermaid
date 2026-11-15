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

export class EdgeConstraint extends Enum<EdgeConstraint> {
  static readonly NONE = new EdgeConstraint('NONE', 0)
  static readonly INCOMING_ONLY = new EdgeConstraint('INCOMING_ONLY', 1)
  static readonly OUTGOING_ONLY = new EdgeConstraint('OUTGOING_ONLY', 2)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): EdgeConstraint[] { return [EdgeConstraint.NONE, EdgeConstraint.INCOMING_ONLY, EdgeConstraint.OUTGOING_ONLY] }
  static valueOf(name: string): EdgeConstraint {
    for (const value of EdgeConstraint.values()) if (value.name() === name) return value
    throw new Error(`Unknown EdgeConstraint value: ${name}`)
  }
}
