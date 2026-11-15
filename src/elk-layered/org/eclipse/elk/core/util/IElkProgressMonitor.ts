/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'
import type { ElkNode } from '../../graph/ElkNode.ts'
import type { IElkCancelIndicator } from './IElkCancelIndicator.ts'
import type { LoggedGraph } from './LoggedGraph.ts'
export interface IElkProgressMonitor extends IElkCancelIndicator {
  begin(name: string, totalWork: number): boolean
  worked(work: number): void
  done(): void
  isRunning(): boolean
  getTaskName(): string | null
  subTask(work: number): IElkProgressMonitor | null
  getSubMonitors(): AbstractList<IElkProgressMonitor>
  getParentMonitor(): IElkProgressMonitor | null
  isLoggingEnabled(): boolean
  isLogPersistenceEnabled(): boolean
  log(object: unknown): void
  getLogs(): AbstractList<string>
  logGraph(graph: ElkNode, tag: string): void
  logGraph(graph: unknown, tag: string, graphType: LoggedGraph.Type): void
  getLoggedGraphs(): AbstractList<LoggedGraph>
  isExecutionTimeMeasured(): boolean
  getExecutionTime(): number
}
export namespace IElkProgressMonitor { export const UNKNOWN_WORK = -1 }
