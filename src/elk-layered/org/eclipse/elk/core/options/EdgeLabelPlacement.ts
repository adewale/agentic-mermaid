/*******************************************************************************
 * Copyright (c) 2009, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'

export class EdgeLabelPlacement extends Enum<EdgeLabelPlacement> {
  static readonly CENTER = new EdgeLabelPlacement('CENTER', 0)
  static readonly HEAD = new EdgeLabelPlacement('HEAD', 1)
  static readonly TAIL = new EdgeLabelPlacement('TAIL', 2)
  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): EdgeLabelPlacement[] { return [EdgeLabelPlacement.CENTER, EdgeLabelPlacement.HEAD, EdgeLabelPlacement.TAIL] }
  static valueOf(name: string): EdgeLabelPlacement { for (const value of EdgeLabelPlacement.values()) if (value.name() === name) return value; throw new Error(`Unknown EdgeLabelPlacement value: ${name}`) }
  isEndLabelPlacement(): boolean { return this === EdgeLabelPlacement.HEAD || this === EdgeLabelPlacement.TAIL }
}
