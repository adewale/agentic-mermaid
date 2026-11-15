/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../../java/lang/Enum.ts'

export class InteractiveReferencePoint extends Enum<InteractiveReferencePoint> {
  static readonly CENTER = new InteractiveReferencePoint('CENTER', 0)
  static readonly TOP_LEFT = new InteractiveReferencePoint('TOP_LEFT', 1)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): InteractiveReferencePoint[] { return [InteractiveReferencePoint.CENTER, InteractiveReferencePoint.TOP_LEFT] }
  static valueOf(name: string): InteractiveReferencePoint {
    for (const value of InteractiveReferencePoint.values()) if (value.name() === name) return value
    throw new Error(`Unknown InteractiveReferencePoint value: ${name}`)
  }
}
