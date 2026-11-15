/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Property } from '../../graph/properties/Property.ts'
import { EdgeLabelPlacement } from './EdgeLabelPlacement.ts'

export class CoreOptions {
  private static readonly EDGE_LABELS_PLACEMENT_DEFAULT = EdgeLabelPlacement.CENTER
  static readonly EDGE_LABELS_PLACEMENT = new Property<EdgeLabelPlacement>('org.eclipse.elk.edgeLabels.placement', CoreOptions.EDGE_LABELS_PLACEMENT_DEFAULT, null, null)
  private static readonly EDGE_LABELS_INLINE_DEFAULT = false
  static readonly EDGE_LABELS_INLINE = new Property<boolean>('org.eclipse.elk.edgeLabels.inline', CoreOptions.EDGE_LABELS_INLINE_DEFAULT, null, null)
}
