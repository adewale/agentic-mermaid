/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import { JavaObject, javaHashCode } from '../../../../../java/lang/Object.ts'
import type { AbstractSet } from '../../../../../java/util/AbstractSet.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import { HashMap, type MapView } from '../../../../../java/util/HashMap.ts'
import type { AbstractLayoutProvider } from '../AbstractLayoutProvider.ts'
import type { IFactory } from '../util/IFactory.ts'
import { InstancePool } from '../util/InstancePool.ts'
import type { IValidatingGraphElementVisitor } from '../validation/IValidatingGraphElementVisitor.ts'
import { GraphFeature } from '../../graph/properties/GraphFeature.ts'
import type { IProperty } from '../../graph/properties/IProperty.ts'
import type { ILayoutMetaData } from './ILayoutMetaData.ts'

export class LayoutAlgorithmData extends JavaObject implements ILayoutMetaData {
  private readonly id: string
  private readonly name: string
  private readonly providerPool: InstancePool<AbstractLayoutProvider>
  private readonly category: string
  private readonly melkBundleName: string
  private readonly definingBundleId: string
  private readonly description: string
  private readonly imagePath: string
  private readonly supportedFeatures: AbstractSet<GraphFeature>
  private readonly validatorClass: Class<IValidatingGraphElementVisitor> | null
  private readonly knownOptions = new HashMap<string, unknown>()

  constructor(builder: LayoutAlgorithmData.Builder) {
    super()
    this.id = builder.data.id
    this.name = builder.data.name
    this.description = builder.data.description
    this.providerPool = new InstancePool(builder.data.providerFactory!)
    this.category = builder.data.category
    this.melkBundleName = builder.data.melkBundleName
    this.definingBundleId = builder.data.definingBundleId
    this.imagePath = builder.data.imagePath
    this.supportedFeatures = builder.data.supportedFeatures ?? EnumSet.noneOf(Class.of(GraphFeature))
    this.validatorClass = builder.data.validatorClass
  }
  override equals(obj: unknown): boolean { if (!(obj instanceof LayoutAlgorithmData)) return false; if (this.id === null) throw new TypeError('Null identifier'); return this.id === obj.id }
  override hashCode(): number { if (this.id === null) throw new TypeError('Null identifier'); return javaHashCode(this.id) }
  override toString(): string { return `Layout Algorithm: ${this.id}` }
  addKnownOption(property: IProperty<unknown>, defaultValue: unknown): void { this.knownOptions.put(property.getId(), defaultValue) }
  getKnownOptionIds(): MapView<string> { return this.knownOptions.keySet() }
  knowsOption(property: IProperty<unknown> | string): boolean { return this.knownOptions.containsKey(typeof property === 'string' ? property : property.getId()) }
  getDefaultValue(property: IProperty<unknown> | string): unknown { return this.knownOptions.get(typeof property === 'string' ? property : property.getId()) }
  supportsFeature(graphFeature: GraphFeature): boolean { return this.supportedFeatures.contains(graphFeature) }
  getSupportedFeatures(): AbstractSet<GraphFeature> { return this.supportedFeatures }
  getId(): string { return this.id }
  getName(): string { return this.name }
  getDescription(): string { return this.description }
  getInstancePool(): InstancePool<AbstractLayoutProvider> { return this.providerPool }
  getValidatorClass(): Class<IValidatingGraphElementVisitor> | null { return this.validatorClass }
  getCategoryId(): string { return this.category }
  getBundleName(): string { return this.melkBundleName }
  getDefiningBundleId(): string { return this.definingBundleId }
  getPreviewImagePath(): string { return this.imagePath }
}

export namespace LayoutAlgorithmData {
  export class Builder {
    readonly data = {
      id: null as unknown as string, name: null as unknown as string, providerFactory: null as IFactory<AbstractLayoutProvider> | null,
      category: null as unknown as string, melkBundleName: null as unknown as string, definingBundleId: null as unknown as string,
      description: null as unknown as string, imagePath: null as unknown as string, supportedFeatures: null as AbstractSet<GraphFeature> | null,
      validatorClass: null as Class<IValidatingGraphElementVisitor> | null,
    }
    create(): LayoutAlgorithmData { return new LayoutAlgorithmData(this) }
    id(aid: string): this { this.data.id = aid; return this }
    name(aname: string): this { this.data.name = aname; return this }
    providerFactory(aproviderFactory: IFactory<AbstractLayoutProvider> | null): this { this.data.providerFactory = aproviderFactory; return this }
    category(acategory: string): this { this.data.category = acategory; return this }
    melkBundleName(amelkBundleName: string): this { this.data.melkBundleName = amelkBundleName; return this }
    definingBundleId(adefiningBundleId: string): this { this.data.definingBundleId = adefiningBundleId; return this }
    description(adescription: string): this { this.data.description = adescription; return this }
    imagePath(aimagePath: string): this { this.data.imagePath = aimagePath; return this }
    supportedFeatures(asupportedFeatures: AbstractSet<GraphFeature> | null): this { this.data.supportedFeatures = asupportedFeatures; return this }
    validatorClass(avalidator: Class<IValidatingGraphElementVisitor> | null): this { this.data.validatorClass = avalidator; return this }
  }
}
