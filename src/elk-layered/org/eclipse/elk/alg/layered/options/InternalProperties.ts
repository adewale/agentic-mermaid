/*******************************************************************************
 * Copyright (c) 2010, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Property } from '../../../graph/properties/Property.ts'
import type { AbstractList } from '../../../../../../java/util/AbstractList.ts'
import type { LLabel } from '../graph/LLabel.ts'

export class InternalProperties {
  static readonly ORIGIN = new Property<unknown>('origin')
  static readonly REPRESENTED_LABELS = new Property<AbstractList<LLabel>>('representedLabels')
  static readonly REVERSED = new Property<boolean>('reversed', false)
  static readonly INPUT_COLLECT = new Property<boolean>('inputCollect', false)
  static readonly OUTPUT_COLLECT = new Property<boolean>('outputCollect', false)
}
