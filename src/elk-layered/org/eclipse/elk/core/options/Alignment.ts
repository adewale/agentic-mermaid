/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'

export class Alignment extends Enum<Alignment> {
  static readonly AUTOMATIC = new Alignment('AUTOMATIC', 0)
  static readonly LEFT = new Alignment('LEFT', 1)
  static readonly RIGHT = new Alignment('RIGHT', 2)
  static readonly TOP = new Alignment('TOP', 3)
  static readonly BOTTOM = new Alignment('BOTTOM', 4)
  static readonly CENTER = new Alignment('CENTER', 5)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): Alignment[] { return [Alignment.AUTOMATIC, Alignment.LEFT, Alignment.RIGHT, Alignment.TOP, Alignment.BOTTOM, Alignment.CENTER] }
  static valueOf(name: string): Alignment {
    for (const value of Alignment.values()) if (value.name() === name) return value
    throw new Error(`Unknown Alignment value: ${name}`)
  }
}
