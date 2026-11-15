/*******************************************************************************
 * Copyright (c) 2010, 2019 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { LShape } from './LShape.ts'

export class LLabel extends LShape {
  static readonly #serialVersionUID = -264988654527750053n
  private text: string | null

  constructor(thetext: string | null = '') { super(); this.text = thetext }
  getText(): string | null { return this.text }
  override toString(): string {
    const designation = this.getDesignation()
    if (designation === null) return 'label'
    return 'l_' + designation
  }
  override getDesignation(): string | null {
    if (this.text !== null && this.text !== '') return this.text
    return super.getDesignation()
  }
}
