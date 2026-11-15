/*******************************************************************************
 * Copyright (c) 2011, 2019 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { KVector } from '../../../core/math/KVector.ts'
import { LGraphElement } from './LGraphElement.ts'

export abstract class LShape extends LGraphElement {
  static readonly #serialVersionUID = 5111245934175354687n
  private readonly pos = new KVector()
  private readonly size = new KVector()
  getPosition(): KVector { return this.pos }
  getSize(): KVector { return this.size }
}
