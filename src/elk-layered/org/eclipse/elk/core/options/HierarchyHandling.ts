/*******************************************************************************
 * Copyright (c) 2016, 2020 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'

export class HierarchyHandling extends Enum<HierarchyHandling> {
  static readonly INHERIT = new HierarchyHandling('INHERIT', 0)
  static readonly INCLUDE_CHILDREN = new HierarchyHandling('INCLUDE_CHILDREN', 1)
  static readonly SEPARATE_CHILDREN = new HierarchyHandling('SEPARATE_CHILDREN', 2)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): HierarchyHandling[] { return [HierarchyHandling.INHERIT, HierarchyHandling.INCLUDE_CHILDREN, HierarchyHandling.SEPARATE_CHILDREN] }
  static valueOf(name: string): HierarchyHandling {
    for (const value of HierarchyHandling.values()) if (value.name() === name) return value
    throw new Error(`Unknown HierarchyHandling value: ${name}`)
  }
}
