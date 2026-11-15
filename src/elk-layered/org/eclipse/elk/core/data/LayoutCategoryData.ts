/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject, javaHashCode } from '../../../../../java/lang/Object.ts'
import { LinkedList } from '../../../../../java/util/LinkedList.ts'
import type { LayoutAlgorithmData } from './LayoutAlgorithmData.ts'
import type { ILayoutMetaData } from './ILayoutMetaData.ts'

export class LayoutCategoryData extends JavaObject implements ILayoutMetaData {
  private readonly id: string
  private readonly name: string
  private readonly description: string
  private readonly layouters = new LinkedList<LayoutAlgorithmData>()

  constructor(builder: LayoutCategoryData.Builder) {
    super()
    this.id = builder.data.id
    this.name = builder.data.name
    this.description = builder.data.description
  }
  override equals(obj: unknown): boolean { if (!(obj instanceof LayoutCategoryData)) return false; if (this.id === null) throw new TypeError('Null identifier'); return this.id === obj.id }
  override hashCode(): number { if (this.id === null) throw new TypeError('Null identifier'); return javaHashCode(this.id) }
  override toString(): string { return `Layout Type: ${this.id}` }
  getLayouters(): LinkedList<LayoutAlgorithmData> { return this.layouters }
  getId(): string { return this.id }
  getName(): string { return this.name }
  getDescription(): string { return this.description }
}

export namespace LayoutCategoryData {
  export class Builder {
    readonly data = { id: null as unknown as string, name: null as unknown as string, description: null as unknown as string }
    create(): LayoutCategoryData { return new LayoutCategoryData(this) }
    id(aid: string): this { this.data.id = aid; return this }
    name(aname: string): this { this.data.name = aname; return this }
    description(adescription: string): this { this.data.description = adescription; return this }
  }
}
