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
import { Class } from '../../../../../../java/lang/Class.ts'
import { EnumSet } from '../../../../../../java/util/EnumSet.ts'
import { KVector } from '../../../core/math/KVector.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import { GraphProperties } from './GraphProperties.ts'
import { EdgeConstraint } from './EdgeConstraint.ts'
import { InLayerConstraint } from './InLayerConstraint.ts'

export class InternalProperties {
  static readonly ORIGIN = new Property<unknown>('origin')
  static readonly REPRESENTED_LABELS = new Property<AbstractList<LLabel>>('representedLabels')
  static readonly REVERSED = new Property<boolean>('reversed', false)
  static readonly INPUT_COLLECT = new Property<boolean>('inputCollect', false)
  static readonly OUTPUT_COLLECT = new Property<boolean>('outputCollect', false)
  static readonly GRAPH_PROPERTIES = new Property<EnumSet<GraphProperties>>('graphProperties', EnumSet.noneOf(Class.of(GraphProperties)))
  static readonly EXT_PORT_SIZE = new Property<KVector>('externalPortSize', new KVector())
  static readonly PORT_RATIO_OR_POSITION = new Property<number>('portRatioOrPosition', 0)
  static readonly EDGE_CONSTRAINT = new Property<EdgeConstraint>('edgeConstraint', EdgeConstraint.NONE)
  static readonly IN_LAYER_CONSTRAINT = new Property<InLayerConstraint>('inLayerConstraint', InLayerConstraint.NONE)
  static readonly EXT_PORT_SIDE = new Property<PortSide>('externalPortSide', PortSide.UNDEFINED)
  static readonly MODEL_ORDER = new Property<number>('modelOrder')
}
