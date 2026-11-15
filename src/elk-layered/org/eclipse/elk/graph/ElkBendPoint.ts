/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EObject } from '../../emf/ecore/EObject.ts'

export const ElkBendPoint = Symbol('org.eclipse.elk.graph.ElkBendPoint')

export interface ElkBendPoint extends EObject {
  readonly [ElkBendPoint]: true
  getX(): number
  setX(value: number): void
  getY(): number
  setY(value: number): void
  set(x: number, y: number): void
}

export function isElkBendPoint(value: unknown): value is ElkBendPoint { return value !== null && typeof value === 'object' && (value as ElkBendPoint)[ElkBendPoint] === true }
