/*******************************************************************************
 * Copyright (c) 2016 TypeFox GmbH and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'
import { JavaObject, javaHashCode } from '../../../../../java/lang/Object.ts'
import type { ElkGraphElement } from '../../graph/ElkGraphElement.ts'
import { ElkUtil } from '../util/ElkUtil.ts'

export class GraphIssue extends JavaObject {
  constructor(private readonly element: ElkGraphElement | null, private readonly message: string, private readonly severity: GraphIssue.Severity) {
    super()
    if (message === null || severity === null) throw new TypeError('Null value')
  }
  getElement(): ElkGraphElement | null { return this.element }
  getMessage(): string { return this.message }
  getSeverity(): GraphIssue.Severity { return this.severity }
  override equals(obj: unknown): boolean { return obj instanceof GraphIssue && this.element === obj.element && this.message === obj.message && this.severity === obj.severity }
  override hashCode(): number {
    if (this.element === null) throw new TypeError('Null value')
    return javaHashCode(this.element) ^ javaHashCode(this.message) ^ javaHashCode(this.severity)
  }
  override toString(): string {
    const parts: string[] = []
    const result = { append(value: unknown) { parts.push(String(value)); return this } }
    result.append(this.severity).append(': ').append(this.message).append(' (')
    ElkUtil.printElementPath(this.element!, result)
    result.append(')')
    return parts.join('')
  }
}

export namespace GraphIssue {
  export class Severity extends Enum<Severity> {
    static readonly ERROR = new Severity('ERROR', 0, 'Error')
    static readonly WARNING = new Severity('WARNING', 1, 'Warning')
    private constructor(name: string, ordinal: number, private readonly userString: string) { super(name, ordinal) }
    getUserString(): string { return this.userString }
    static values(): Severity[] { return [Severity.ERROR, Severity.WARNING] }
    static valueOf(name: string): Severity { for (const value of Severity.values()) if (value.name() === name) return value; throw new IllegalArgumentException(`No enum constant ${name}`) }
  }
}
