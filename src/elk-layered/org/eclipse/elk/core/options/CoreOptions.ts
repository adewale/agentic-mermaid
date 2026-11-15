/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Property } from '../../graph/properties/Property.ts'
import type { IPropertyHolder } from '../../graph/properties/IPropertyHolder.ts'
import { EdgeLabelPlacement } from './EdgeLabelPlacement.ts'
import { Class } from '../../../../../java/lang/Class.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import { KVectorChain } from '../math/KVectorChain.ts'
import type { KVector } from '../math/KVector.ts'
import { ExclusiveBounds } from '../util/ExclusiveBounds.ts'
import { Alignment } from './Alignment.ts'
import { Direction } from './Direction.ts'
import { PortConstraints } from './PortConstraints.ts'
import { PortSide } from './PortSide.ts'
import { SizeConstraint } from './SizeConstraint.ts'

export class CoreOptions {
  private static readonly ASPECT_RATIO_LOWER_BOUND = ExclusiveBounds.greaterThan(0)
  static readonly ASPECT_RATIO = new Property<number>('org.eclipse.elk.aspectRatio', null as unknown as number, CoreOptions.ASPECT_RATIO_LOWER_BOUND, null)
  private static readonly ALIGNMENT_DEFAULT = Alignment.AUTOMATIC
  static readonly ALIGNMENT = new Property<Alignment>('org.eclipse.elk.alignment', CoreOptions.ALIGNMENT_DEFAULT, null, null)
  private static readonly DIRECTION_DEFAULT = Direction.UNDEFINED
  static readonly DIRECTION = new Property<Direction>('org.eclipse.elk.direction', CoreOptions.DIRECTION_DEFAULT, null, null)
  private static readonly COMMENT_BOX_DEFAULT = false
  static readonly COMMENT_BOX = new Property<boolean>('org.eclipse.elk.commentBox', CoreOptions.COMMENT_BOX_DEFAULT, null, null)
  private static readonly HYPERNODE_DEFAULT = false
  static readonly HYPERNODE = new Property<boolean>('org.eclipse.elk.hypernode', CoreOptions.HYPERNODE_DEFAULT, null, null)
  private static readonly PORT_CONSTRAINTS_DEFAULT = PortConstraints.UNDEFINED
  static readonly PORT_CONSTRAINTS = new Property<PortConstraints>('org.eclipse.elk.portConstraints', CoreOptions.PORT_CONSTRAINTS_DEFAULT, null, null)
  static readonly PORT_BORDER_OFFSET = new Property<number>('org.eclipse.elk.port.borderOffset')
  private static readonly PORT_SIDE_DEFAULT = PortSide.UNDEFINED
  static readonly PORT_SIDE = new Property<PortSide>('org.eclipse.elk.port.side', CoreOptions.PORT_SIDE_DEFAULT, null, null)
  static readonly PORT_ANCHOR = new Property<KVector>('org.eclipse.elk.port.anchor')
  static readonly PORT_INDEX = new Property<number>('org.eclipse.elk.port.index')
  private static readonly NODE_SIZE_CONSTRAINTS_DEFAULT = EnumSet.noneOf(Class.of(SizeConstraint))
  static readonly NODE_SIZE_CONSTRAINTS = new Property<EnumSet<SizeConstraint>>('org.eclipse.elk.nodeSize.constraints', CoreOptions.NODE_SIZE_CONSTRAINTS_DEFAULT, null, null)
  private static readonly JUNCTION_POINTS_DEFAULT = new KVectorChain()
  static readonly JUNCTION_POINTS = new Property<KVectorChain>('org.eclipse.elk.junctionPoints', CoreOptions.JUNCTION_POINTS_DEFAULT, null, null)
  static readonly SPACING_INDIVIDUAL = new Property<IPropertyHolder>('org.eclipse.elk.spacing.individual')
  private static readonly EDGE_LABELS_PLACEMENT_DEFAULT = EdgeLabelPlacement.CENTER
  static readonly EDGE_LABELS_PLACEMENT = new Property<EdgeLabelPlacement>('org.eclipse.elk.edgeLabels.placement', CoreOptions.EDGE_LABELS_PLACEMENT_DEFAULT, null, null)
  private static readonly EDGE_LABELS_INLINE_DEFAULT = false
  static readonly EDGE_LABELS_INLINE = new Property<boolean>('org.eclipse.elk.edgeLabels.inline', CoreOptions.EDGE_LABELS_INLINE_DEFAULT, null, null)
}
