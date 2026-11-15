/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { ElkGraphElement } from './ElkGraphElement.ts'

export const ElkShape = Symbol('org.eclipse.elk.graph.ElkShape')

export interface ElkShape extends ElkGraphElement {
  readonly [ElkShape]: true
  getHeight(): number
  setHeight(value: number): void
  getWidth(): number
  setWidth(value: number): void
  getX(): number
  setX(value: number): void
  getY(): number
  setY(value: number): void
  setDimensions(width: number, height: number): void
  setLocation(x: number, y: number): void
}

export function isElkShape(value: unknown): value is ElkShape { return value !== null && typeof value === 'object' && (value as ElkShape)[ElkShape] === true }
