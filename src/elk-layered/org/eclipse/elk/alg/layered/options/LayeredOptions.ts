/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { CoreOptions } from '../../../core/options/CoreOptions.ts'
import { LayeredMetaDataProvider } from './LayeredMetaDataProvider.ts'

export class LayeredOptions {
  static readonly EDGE_LABELS_PLACEMENT = CoreOptions.EDGE_LABELS_PLACEMENT
  static readonly EDGE_LABELS_INLINE = CoreOptions.EDGE_LABELS_INLINE
  static readonly INTERACTIVE_REFERENCE_POINT = LayeredMetaDataProvider.INTERACTIVE_REFERENCE_POINT
}
