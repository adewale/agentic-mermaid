/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { CoreOptions } from '../../../core/options/CoreOptions.ts'
import { LayeredMetaDataProvider } from './LayeredMetaDataProvider.ts'
import { Property } from '../../../graph/properties/Property.ts'
import { Direction } from '../../../core/options/Direction.ts'

export class LayeredOptions {
  private static readonly DIRECTION_DEFAULT = Direction.UNDEFINED
  static readonly DIRECTION = new Property(CoreOptions.DIRECTION, LayeredOptions.DIRECTION_DEFAULT)
  private static readonly PORT_BORDER_OFFSET_DEFAULT = 0
  static readonly PORT_BORDER_OFFSET = new Property(CoreOptions.PORT_BORDER_OFFSET, LayeredOptions.PORT_BORDER_OFFSET_DEFAULT)
  private static readonly ASPECT_RATIO_DEFAULT = Math.fround(1.6)
  static readonly ASPECT_RATIO = new Property(CoreOptions.ASPECT_RATIO, LayeredOptions.ASPECT_RATIO_DEFAULT)
  static readonly ALIGNMENT = CoreOptions.ALIGNMENT
  static readonly COMMENT_BOX = CoreOptions.COMMENT_BOX
  static readonly HYPERNODE = CoreOptions.HYPERNODE
  static readonly PORT_CONSTRAINTS = CoreOptions.PORT_CONSTRAINTS
  static readonly PORT_SIDE = CoreOptions.PORT_SIDE
  static readonly PORT_ANCHOR = CoreOptions.PORT_ANCHOR
  static readonly PORT_INDEX = CoreOptions.PORT_INDEX
  static readonly NODE_SIZE_CONSTRAINTS = CoreOptions.NODE_SIZE_CONSTRAINTS
  static readonly JUNCTION_POINTS = CoreOptions.JUNCTION_POINTS
  static readonly SPACING_INDIVIDUAL = CoreOptions.SPACING_INDIVIDUAL
  static readonly MERGE_EDGES = LayeredMetaDataProvider.MERGE_EDGES
  static readonly LAYERING_LAYER_CONSTRAINT = LayeredMetaDataProvider.LAYERING_LAYER_CONSTRAINT
  static readonly EDGE_LABELS_PLACEMENT = CoreOptions.EDGE_LABELS_PLACEMENT
  static readonly EDGE_LABELS_INLINE = CoreOptions.EDGE_LABELS_INLINE
  static readonly INTERACTIVE_REFERENCE_POINT = LayeredMetaDataProvider.INTERACTIVE_REFERENCE_POINT
}
