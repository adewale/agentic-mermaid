/*******************************************************************************
 * Copyright (c) 2008, 2020 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { isElkGraphElement, type ElkGraphElement } from '../../graph/ElkGraphElement.ts'
import { isElkLabel } from '../../graph/ElkLabel.ts'
import { isElkEdge } from '../../graph/ElkEdge.ts'

export class ElkUtil {
  static printElementPath(element: ElkGraphElement, builder: { append(value: unknown): unknown }): void {
    if (isElkGraphElement(element.eContainer())) {
      ElkUtil.printElementPath(element.eContainer() as ElkGraphElement, builder)
      builder.append(' > ')
    } else builder.append('Root ')
    const className = element.eClass().getName()!
    builder.append(className.startsWith('Elk') ? className.substring(3) : className)
    const identifier = element.getIdentifier()
    if (identifier !== null && identifier.length !== 0) { builder.append(' '); builder.append(identifier); return }
    if (isElkLabel(element)) {
      const text = element.getText()
      if (text !== null && text.length !== 0) { builder.append(' '); builder.append(text); return }
    }
    for (const label of element.getLabels()) {
      const text = label.getText()
      if (text !== null && text.length !== 0) { builder.append(' '); builder.append(text); return }
    }
    if (isElkEdge(element) && element.isConnected()) {
      builder.append(' (')
      const sourceIter = element.getSources().listIterator()
      while (sourceIter.hasNext()) {
        if (sourceIter.nextIndex() > 0) builder.append(', ')
        ElkUtil.printElementPath(sourceIter.next(), builder)
      }
      builder.append(' -> ')
      const targetIter = element.getTargets().listIterator()
      while (targetIter.hasNext()) {
        if (targetIter.nextIndex() > 0) builder.append(', ')
        ElkUtil.printElementPath(targetIter.next(), builder)
      }
      builder.append(')')
    }
  }
}
