/*******************************************************************************
 * Copyright (c) 2010, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { InternalProperties } from '../../options/InternalProperties.ts'
import { isElkGraphElement, type ElkGraphElement } from '../../../../graph/ElkGraphElement.ts'
import type { LGraphElement } from '../LGraphElement.ts'

export class ElkGraphTransformer {
  static getOriginIdentifier(element: LGraphElement): string | null {
    const origin = element.getProperty(InternalProperties.ORIGIN)
    if (isElkGraphElement(origin)) return ElkGraphTransformer.getIdentifier(origin)
    return null
  }

  private static getIdentifier(element: ElkGraphElement): string | null {
    const id = element.getIdentifier()
    if (id !== null && id !== '') {
      const container = element.eContainer()
      if (isElkGraphElement(container)) {
        const parentId = ElkGraphTransformer.getIdentifier(container)
        if (parentId !== null) return parentId + '.' + id
      }
      return id
    }
    return null
  }
}
