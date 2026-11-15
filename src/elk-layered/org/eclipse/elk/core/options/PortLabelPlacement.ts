/*******************************************************************************
 * Copyright (c) 2012, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { Class } from '../../../../../java/lang/Class.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import type { AbstractSet } from '../../../../../java/util/AbstractSet.ts'
import { Sets } from '../../../../../com/google/common/collect/Sets.ts'

export class PortLabelPlacement extends Enum<PortLabelPlacement> {
  static readonly OUTSIDE = new PortLabelPlacement('OUTSIDE', 0)
  static readonly INSIDE = new PortLabelPlacement('INSIDE', 1)
  static readonly NEXT_TO_PORT_IF_POSSIBLE = new PortLabelPlacement('NEXT_TO_PORT_IF_POSSIBLE', 2)
  static readonly ALWAYS_SAME_SIDE = new PortLabelPlacement('ALWAYS_SAME_SIDE', 3)
  static readonly ALWAYS_OTHER_SAME_SIDE = new PortLabelPlacement('ALWAYS_OTHER_SAME_SIDE', 4)
  static readonly SPACE_EFFICIENT = new PortLabelPlacement('SPACE_EFFICIENT', 5)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): PortLabelPlacement[] { return [PortLabelPlacement.OUTSIDE, PortLabelPlacement.INSIDE, PortLabelPlacement.NEXT_TO_PORT_IF_POSSIBLE, PortLabelPlacement.ALWAYS_SAME_SIDE, PortLabelPlacement.ALWAYS_OTHER_SAME_SIDE, PortLabelPlacement.SPACE_EFFICIENT] }
  static valueOf(name: string): PortLabelPlacement { for (const value of PortLabelPlacement.values()) if (value.name() === name) return value; throw new Error(`Unknown PortLabelPlacement value: ${name}`) }
  static fixed(): EnumSet<PortLabelPlacement> { return EnumSet.noneOf(Class.of(PortLabelPlacement)) }
  static inside(): EnumSet<PortLabelPlacement> { return EnumSet.of(PortLabelPlacement.INSIDE) }
  static outside(): EnumSet<PortLabelPlacement> { return EnumSet.of(PortLabelPlacement.OUTSIDE) }
  static isFixed(placement: AbstractSet<PortLabelPlacement>): boolean { return !placement.contains(PortLabelPlacement.INSIDE) && !placement.contains(PortLabelPlacement.OUTSIDE) }
  static isValid(placement: AbstractSet<PortLabelPlacement>): boolean {
    const validInsideOutside = EnumSet.of(PortLabelPlacement.INSIDE, PortLabelPlacement.OUTSIDE)
    if (Sets.intersection(validInsideOutside, placement).size() > 1) return false
    const validPosition = EnumSet.of(PortLabelPlacement.ALWAYS_SAME_SIDE, PortLabelPlacement.ALWAYS_OTHER_SAME_SIDE, PortLabelPlacement.SPACE_EFFICIENT)
    if (Sets.intersection(validPosition, placement).size() > 1) return false
    return true
  }
}
