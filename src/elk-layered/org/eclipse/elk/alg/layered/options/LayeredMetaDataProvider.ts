/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Property } from '../../../graph/properties/Property.ts'
import { InteractiveReferencePoint } from './InteractiveReferencePoint.ts'
import { LayerConstraint } from './LayerConstraint.ts'

export class LayeredMetaDataProvider {
  private static readonly INTERACTIVE_REFERENCE_POINT_DEFAULT = InteractiveReferencePoint.CENTER
  static readonly INTERACTIVE_REFERENCE_POINT = new Property<InteractiveReferencePoint>('org.eclipse.elk.layered.interactiveReferencePoint', LayeredMetaDataProvider.INTERACTIVE_REFERENCE_POINT_DEFAULT, null, null)
  private static readonly MERGE_EDGES_DEFAULT = false
  static readonly MERGE_EDGES = new Property<boolean>('org.eclipse.elk.layered.mergeEdges', LayeredMetaDataProvider.MERGE_EDGES_DEFAULT, null, null)
  private static readonly LAYERING_LAYER_CONSTRAINT_DEFAULT = LayerConstraint.NONE
  static readonly LAYERING_LAYER_CONSTRAINT = new Property<LayerConstraint>('org.eclipse.elk.layered.layering.layerConstraint', LayeredMetaDataProvider.LAYERING_LAYER_CONSTRAINT_DEFAULT, null, null)
}
