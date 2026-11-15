/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'

export class Direction extends Enum<Direction> {
  static readonly UNDEFINED = new Direction('UNDEFINED', 0)
  static readonly RIGHT = new Direction('RIGHT', 1)
  static readonly LEFT = new Direction('LEFT', 2)
  static readonly DOWN = new Direction('DOWN', 3)
  static readonly UP = new Direction('UP', 4)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): Direction[] { return [Direction.UNDEFINED, Direction.RIGHT, Direction.LEFT, Direction.DOWN, Direction.UP] }
  static valueOf(name: string): Direction { for (const value of Direction.values()) if (value.name() === name) return value; throw new Error(`Unknown Direction value: ${name}`) }
  isHorizontal(): boolean { return this === Direction.LEFT || this === Direction.RIGHT }
  isVertical(): boolean { return this === Direction.UP || this === Direction.DOWN }
  opposite(): Direction {
    switch (this) {
      case Direction.LEFT: return Direction.RIGHT
      case Direction.RIGHT: return Direction.LEFT
      case Direction.UP: return Direction.DOWN
      case Direction.DOWN: return Direction.UP
      default: return Direction.UNDEFINED
    }
  }
}
