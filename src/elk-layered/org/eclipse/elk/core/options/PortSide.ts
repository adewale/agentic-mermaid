/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { Class } from '../../../../../java/lang/Class.ts'
import { Collections } from '../../../../../java/util/Collections.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import { Sets } from '../../../../../com/google/common/collect/Sets.ts'
import { Direction } from './Direction.ts'

export class PortSide extends Enum<PortSide> {
  static readonly UNDEFINED = new PortSide('UNDEFINED', 0)
  static readonly NORTH = new PortSide('NORTH', 1)
  static readonly EAST = new PortSide('EAST', 2)
  static readonly SOUTH = new PortSide('SOUTH', 3)
  static readonly WEST = new PortSide('WEST', 4)

  static readonly SIDES_NONE = Collections.unmodifiableSet(EnumSet.noneOf(Class.of(PortSide)))
  static readonly SIDES_NORTH = Sets.immutableEnumSet(PortSide.NORTH)
  static readonly SIDES_EAST = Sets.immutableEnumSet(PortSide.EAST)
  static readonly SIDES_SOUTH = Sets.immutableEnumSet(PortSide.SOUTH)
  static readonly SIDES_WEST = Sets.immutableEnumSet(PortSide.WEST)
  static readonly SIDES_NORTH_SOUTH = Sets.immutableEnumSet(PortSide.NORTH, PortSide.SOUTH)
  static readonly SIDES_EAST_WEST = Sets.immutableEnumSet(PortSide.EAST, PortSide.WEST)
  static readonly SIDES_NORTH_WEST = Sets.immutableEnumSet(PortSide.NORTH, PortSide.WEST)
  static readonly SIDES_NORTH_EAST = Sets.immutableEnumSet(PortSide.NORTH, PortSide.EAST)
  static readonly SIDES_SOUTH_WEST = Sets.immutableEnumSet(PortSide.SOUTH, PortSide.WEST)
  static readonly SIDES_EAST_SOUTH = Sets.immutableEnumSet(PortSide.EAST, PortSide.SOUTH)
  static readonly SIDES_NORTH_EAST_WEST = Sets.immutableEnumSet(PortSide.NORTH, PortSide.EAST, PortSide.WEST)
  static readonly SIDES_EAST_SOUTH_WEST = Sets.immutableEnumSet(PortSide.EAST, PortSide.SOUTH, PortSide.WEST)
  static readonly SIDES_NORTH_SOUTH_WEST = Sets.immutableEnumSet(PortSide.NORTH, PortSide.SOUTH, PortSide.WEST)
  static readonly SIDES_NORTH_EAST_SOUTH = Sets.immutableEnumSet(PortSide.NORTH, PortSide.EAST, PortSide.SOUTH)
  static readonly SIDES_NORTH_EAST_SOUTH_WEST = Sets.immutableEnumSet(PortSide.NORTH, PortSide.EAST, PortSide.SOUTH, PortSide.WEST)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): PortSide[] { return [PortSide.UNDEFINED, PortSide.NORTH, PortSide.EAST, PortSide.SOUTH, PortSide.WEST] }
  static valueOf(name: string): PortSide { for (const value of PortSide.values()) if (value.name() === name) return value; throw new Error(`Unknown PortSide value: ${name}`) }

  right(): PortSide {
    switch (this) {
      case PortSide.NORTH: return PortSide.EAST
      case PortSide.EAST: return PortSide.SOUTH
      case PortSide.SOUTH: return PortSide.WEST
      case PortSide.WEST: return PortSide.NORTH
      default: return PortSide.UNDEFINED
    }
  }

  left(): PortSide {
    switch (this) {
      case PortSide.NORTH: return PortSide.WEST
      case PortSide.EAST: return PortSide.NORTH
      case PortSide.SOUTH: return PortSide.EAST
      case PortSide.WEST: return PortSide.SOUTH
      default: return PortSide.UNDEFINED
    }
  }

  opposed(): PortSide {
    switch (this) {
      case PortSide.NORTH: return PortSide.SOUTH
      case PortSide.EAST: return PortSide.WEST
      case PortSide.SOUTH: return PortSide.NORTH
      case PortSide.WEST: return PortSide.EAST
      default: return PortSide.UNDEFINED
    }
  }

  areAdjacent(other: PortSide): boolean {
    if (this === PortSide.UNDEFINED) return false
    return this.left() === other || this.right() === other
  }

  static fromDirection(direction: Direction): PortSide {
    switch (direction) {
      case Direction.UP: return PortSide.NORTH
      case Direction.RIGHT: return PortSide.EAST
      case Direction.DOWN: return PortSide.SOUTH
      case Direction.LEFT: return PortSide.WEST
      default: return PortSide.UNDEFINED
    }
  }

  static isVertical(side: PortSide): boolean { return side === PortSide.NORTH || side === PortSide.SOUTH }
  static isHorizontal(side: PortSide): boolean { return side === PortSide.WEST || side === PortSide.EAST }
}
