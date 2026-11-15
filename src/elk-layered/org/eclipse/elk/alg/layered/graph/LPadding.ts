/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { ElkPadding } from '../../../core/math/ElkPadding.ts'

export class LPadding extends ElkPadding {
  static readonly #serialVersionUID = -73916295796649526n

  constructor() { super() }

  clone(): LPadding {
    const clone = new LPadding()
    clone.setLeft(this.getLeft())
    clone.setRight(this.getRight())
    clone.setTop(this.getTop())
    clone.setBottom(this.getBottom())
    return clone
  }
}
