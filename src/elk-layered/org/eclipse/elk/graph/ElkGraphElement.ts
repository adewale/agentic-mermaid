/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EList } from '../../emf/common/util/EList.ts'
import type { EMapPropertyHolder } from './EMapPropertyHolder.ts'
import type { ElkLabel } from './ElkLabel.ts'

export const ElkGraphElement = Symbol('org.eclipse.elk.graph.ElkGraphElement')

export interface ElkGraphElement extends EMapPropertyHolder {
  readonly [ElkGraphElement]: true
  getLabels(): EList<ElkLabel>
  getIdentifier(): string | null
  setIdentifier(value: string | null): void
}

export function isElkGraphElement(value: unknown): value is ElkGraphElement {
  return value !== null && typeof value === 'object' && (value as ElkGraphElement)[ElkGraphElement] === true
}
