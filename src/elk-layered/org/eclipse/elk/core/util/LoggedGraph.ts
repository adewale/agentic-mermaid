/*******************************************************************************
 * Copyright (c) 2019 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { JavaObject } from '../../../../../java/lang/Object.ts'
export class LoggedGraph extends JavaObject {
  constructor(private readonly graph: unknown, private readonly tag: string, private readonly graphType: LoggedGraph.Type) { super(); graphType.checkTypeCompatibility(graph) }
  getGraph(): unknown { return this.graph }
  getGraphType(): LoggedGraph.Type { return this.graphType }
  getTag(): string { return this.tag }
  serialize(): string { return String(this.graph) }
}
export namespace LoggedGraph {
  export class Type extends Enum<Type> {
    static readonly ELK = new Type('ELK', 0, 'elkg')
    static readonly JSON = new Type('JSON', 1, 'json')
    static readonly DOT = new Type('DOT', 2, 'dot')
    static readonly SVG = new Type('SVG', 3, 'svg')
    private constructor(name: string, ordinal: number, private readonly fileExtension: string) { super(name, ordinal) }
    static values(): Type[] { return [Type.ELK, Type.JSON, Type.DOT, Type.SVG] }
    static valueOf(name: string): Type { for (const value of Type.values()) if (value.name() === name) return value; throw new Error('Unknown logged graph type: ' + name) }
    checkTypeCompatibility(_object: unknown): void {}
    getFileExtension(): string { return this.fileExtension }
  }
}
