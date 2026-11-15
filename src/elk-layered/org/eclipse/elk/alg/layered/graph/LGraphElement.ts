/*******************************************************************************
 * Copyright (c) 2010, 2019 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { MapPropertyHolder } from '../../../graph/properties/MapPropertyHolder.ts'
import { ElkGraphTransformer } from './transform/ElkGraphTransformer.ts'

export abstract class LGraphElement extends MapPropertyHolder {
  static readonly #serialVersionUID = 5480383439314459124n
  id = 0

  getDesignation(): string | null {
    const identifier = ElkGraphTransformer.getOriginIdentifier(this)
    if (identifier !== null && identifier !== '') return identifier
    return null
  }
}
