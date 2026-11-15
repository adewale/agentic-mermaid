/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Spacing } from './Spacing.ts'

export class ElkMargin extends Spacing {
  static readonly #serialVersionUID = 7465583871643915474n

  constructor()
  constructor(any: number)
  constructor(leftRight: number, topBottom: number)
  constructor(top: number, right: number, bottom: number, left: number)
  constructor(other: ElkMargin)
  constructor(first?: number | ElkMargin, second?: number, third?: number, fourth?: number) {
    if (first === undefined) super()
    else if (first instanceof ElkMargin) super(first.top, first.right, first.bottom, first.left)
    else if (second === undefined) super(first, first, first, first)
    else if (third === undefined) super(second, first, second, first)
    else super(first, second, third, fourth!)
  }

  clone(): ElkMargin { return new ElkMargin(this) }
}
