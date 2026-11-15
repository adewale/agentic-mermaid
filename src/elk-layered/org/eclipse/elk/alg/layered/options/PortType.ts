/*******************************************************************************
 * Copyright (c) 2010, 2015 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../../java/lang/Enum.ts'

export class PortType extends Enum<PortType> {
  static readonly UNDEFINED = new PortType('UNDEFINED', 0)
  static readonly INPUT = new PortType('INPUT', 1)
  static readonly OUTPUT = new PortType('OUTPUT', 2)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): PortType[] { return [PortType.UNDEFINED, PortType.INPUT, PortType.OUTPUT] }
  static valueOf(name: string): PortType {
    for (const value of PortType.values()) if (value.name() === name) return value
    throw new Error(`Unknown PortType value: ${name}`)
  }
}
