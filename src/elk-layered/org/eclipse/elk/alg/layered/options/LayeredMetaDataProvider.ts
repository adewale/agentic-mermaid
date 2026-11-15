/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Property } from '../../../graph/properties/Property.ts'
import { InteractiveReferencePoint } from './InteractiveReferencePoint.ts'

export class LayeredMetaDataProvider {
  private static readonly INTERACTIVE_REFERENCE_POINT_DEFAULT = InteractiveReferencePoint.CENTER
  static readonly INTERACTIVE_REFERENCE_POINT = new Property<InteractiveReferencePoint>('org.eclipse.elk.layered.interactiveReferencePoint', LayeredMetaDataProvider.INTERACTIVE_REFERENCE_POINT_DEFAULT, null, null)
}
