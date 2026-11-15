/*******************************************************************************
 * Copyright (c) 2019 TypeFox and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
// ELK JSON boundary types from elkjs 0.11.1 (572e73323791d05f09b0815ff639af2b67f202ab).
export interface LayoutOptions { [key: string]: string }
export interface ElkPoint { x: number; y: number }
export interface ElkGraphElement { id?: string; labels?: ElkLabel[]; layoutOptions?: LayoutOptions }
export interface ElkShape extends ElkGraphElement { x?: number; y?: number; width?: number; height?: number }
export interface ElkNode extends ElkShape { id: string; children?: ElkNode[]; ports?: ElkPort[]; edges?: ElkExtendedEdge[] }
export interface ElkPort extends ElkShape { id: string }
export interface ElkLabel extends ElkShape { text?: string }
export interface ElkExtendedEdge extends ElkGraphElement { id: string; sources: string[]; targets: string[]; sections?: ElkEdgeSection[]; container?: string; junctionPoints?: ElkPoint[] }
export interface ElkEdgeSection extends ElkGraphElement { id: string; startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[]; incomingShape?: string; outgoingShape?: string; incomingSections?: string[]; outgoingSections?: string[] }
