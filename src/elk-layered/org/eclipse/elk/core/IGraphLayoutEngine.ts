/*******************************************************************************
 * Copyright (c) 2008, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { ElkNode } from '../graph/ElkNode.ts'
import type { IElkProgressMonitor } from './util/IElkProgressMonitor.ts'
export interface IGraphLayoutEngine { layout(layoutGraph: ElkNode, progressMonitor: IElkProgressMonitor): void }
