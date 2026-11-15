/*******************************************************************************
 * Copyright (c) 2012, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { Class } from '../../../../../java/lang/Class.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'

export class SizeConstraint extends Enum<SizeConstraint> {
  static readonly PORTS = new SizeConstraint('PORTS', 0)
  static readonly PORT_LABELS = new SizeConstraint('PORT_LABELS', 1)
  static readonly NODE_LABELS = new SizeConstraint('NODE_LABELS', 2)
  static readonly MINIMUM_SIZE = new SizeConstraint('MINIMUM_SIZE', 3)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): SizeConstraint[] { return [SizeConstraint.PORTS, SizeConstraint.PORT_LABELS, SizeConstraint.NODE_LABELS, SizeConstraint.MINIMUM_SIZE] }
  static valueOf(name: string): SizeConstraint { for (const value of SizeConstraint.values()) if (value.name() === name) return value; throw new Error(`Unknown SizeConstraint value: ${name}`) }
  static fixed(): EnumSet<SizeConstraint> { return EnumSet.noneOf(Class.of(SizeConstraint)) }
  static minimumSize(): EnumSet<SizeConstraint> { return EnumSet.of(SizeConstraint.MINIMUM_SIZE) }
  static minimumSizeWithPorts(): EnumSet<SizeConstraint> { return EnumSet.of(SizeConstraint.PORTS, SizeConstraint.MINIMUM_SIZE) }
  static free(): EnumSet<SizeConstraint> { return EnumSet.allOf(Class.of(SizeConstraint)) }
}
