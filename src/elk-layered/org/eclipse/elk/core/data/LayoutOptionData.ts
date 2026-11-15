/*******************************************************************************
 * Copyright (c) 2009, 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import { isCloneable } from '../../../../../java/lang/Cloneable.ts'
import type { Comparable } from '../../../../../java/lang/Comparable.ts'
import { Double, NumberFormatException } from '../../../../../java/lang/Double.ts'
import { Enum, enumValueOf } from '../../../../../java/lang/Enum.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'
import { IllegalStateException } from '../../../../../java/lang/IllegalStateException.ts'
import { Integer } from '../../../../../java/lang/Integer.ts'
import { JavaObject, javaHashCode } from '../../../../../java/lang/Object.ts'
import { AbstractSet } from '../../../../../java/util/AbstractSet.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import { LinkedList } from '../../../../../java/util/LinkedList.ts'
import type { IDataObject } from '../util/IDataObject.ts'
import { Pair } from '../util/Pair.ts'
import { IProperty } from '../../graph/properties/IProperty.ts'
import { Property } from '../../graph/properties/Property.ts'
import { ElkReflect } from '../../graph/util/ElkReflect.ts'
import type { ILayoutMetaData } from './ILayoutMetaData.ts'

type OptionEnum = Enum<never>

export class LayoutOptionData extends JavaObject implements ILayoutMetaData, IProperty<unknown>, Comparable<IProperty<unknown>> {
  readonly [IProperty] = true
  private readonly id: string
  private readonly group: string
  private readonly legacyIds: string[] | null
  private readonly defaultValue: unknown
  private readonly clazz: Class<unknown> | null
  private readonly type: LayoutOptionData.Type
  private readonly name: string
  private readonly description: string
  private readonly targets: AbstractSet<LayoutOptionData.Target>
  private readonly dependencies = new LinkedList<Pair<LayoutOptionData, unknown>>()
  private choices: string[] | null = null
  private readonly visibility: LayoutOptionData.Visibility | null
  private lowerBound: unknown
  private upperBound: unknown

  constructor(builder: LayoutOptionData.Builder) {
    super()
    this.id = builder.data.id
    this.group = builder.data.group
    this.name = builder.data.name
    this.description = builder.data.description
    this.defaultValue = builder.data.defaultValue
    this.lowerBound = comparableBound(builder.data.lowerBound)
    this.upperBound = comparableBound(builder.data.upperBound)
    this.type = builder.data.type
    this.clazz = builder.data.clazz
    this.targets = builder.data.targets ?? EnumSet.noneOf(Class.of(LayoutOptionData.Target))
    this.visibility = builder.data.visibility
    this.legacyIds = builder.data.legacyIds
  }

  private checkEnumClass(): void {
    if (this.clazz === null || !this.clazz.isEnum()) throw new IllegalStateException(`Enumeration class expected for layout option ${this.id}`)
  }
  private createDataInstance(): IDataObject {
    // elkjs removes the Java-only IDataObject.class.isAssignableFrom check.
    if (this.clazz === null) throw new IllegalStateException(`IDataType class expected for layout option ${this.id}`)
    const instance = ElkReflect.newInstance(this.clazz)
    if (instance === null) throw new IllegalStateException(`Couldn't create new instance of property '${this.id}'. Make sure its type is registered with the ElkReflect utility class.`)
    return instance as IDataObject
  }
  override equals(obj: unknown): boolean {
    if (obj instanceof LayoutOptionData) { if (this.id === null) throw new TypeError('Null identifier'); return this.id === obj.id }
    if (obj === null || typeof obj !== 'object' || (obj as IProperty<unknown>)[IProperty] !== true) return false
    if (this.id === null) throw new TypeError('Null identifier')
    return this.id === (obj as IProperty<unknown>).getId()
  }
  override hashCode(): number { if (this.id === null) throw new TypeError('Null identifier'); return javaHashCode(this.id) }
  compareTo(other: IProperty<unknown>): number {
    const otherId = other.getId()
    const length = Math.min(this.id.length, otherId.length)
    for (let index = 0; index < length; index++) {
      const difference = this.id.charCodeAt(index) - otherId.charCodeAt(index)
      if (difference !== 0) return difference
    }
    return this.id.length - otherId.length
  }
  override toString(): string { return `Layout Option: ${this.id}` }
  canParseValue(): boolean {
    if (this.type === LayoutOptionData.Type.UNDEFINED) return false
    if (this.type === LayoutOptionData.Type.OBJECT) return this.clazz !== null
    return true
  }

  parseValue(valueString: string | null): unknown {
    if (valueString === null || valueString === 'null') return null
    if (valueString.length === 0 && this.type !== LayoutOptionData.Type.ENUMSET) return null
    switch (this.type.ordinal()) {
      case 1:
        if (valueString.toLowerCase() === 'true') return true
        if (valueString.toLowerCase() === 'false') return false
        return null
      case 2:
        try { return Integer.parseInt(valueString) }
        catch (exception) { if (exception instanceof NumberFormatException) return null; throw exception }
      case 4:
        // GWT represents boxed Double values as primitive JavaScript numbers.
        try { return Double.parseDouble(valueString) }
        catch (exception) { if (exception instanceof NumberFormatException) return null; throw exception }
      case 3: return valueString
      case 5: this.checkEnumClass(); return this.enumForString(valueString)
      case 6: this.checkEnumClass(); return this.enumSetForStringArray(this.clazz as Class<OptionEnum>, valueString)
      case 7:
        try { const value = this.createDataInstance(); value.parse(valueString); return value }
        catch (exception) { if (exception instanceof IllegalArgumentException) return null; throw exception }
      default: throw new IllegalStateException('Invalid type set for this layout option.')
    }
  }

  private enumSetForStringArray<E extends Enum<E>>(leClazz: Class<E>, leString: string): EnumSet<E> | null {
    const set = EnumSet.noneOf(leClazz)
    const components = leString.split(/[\[\]\s,]+/)
    for (const component of components) {
      if (component.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').length === 0) continue
      const value = this.enumForString(component)
      if (value === null) return null
      set.add(value as E)
    }
    return set
  }
  private enumForString(leString: string): unknown {
    try { return enumValueOf(this.clazz as Class<OptionEnum>, leString) }
    catch (exception) {
      if (!(exception instanceof IllegalArgumentException)) throw exception
      try {
        const index = Integer.parseInt(leString)
        const constants = this.clazz!.getEnumConstants()
        if (index >= 0 && index < constants.length) return constants[index]
      } catch (exception) { if (!(exception instanceof NumberFormatException)) throw exception }
      return null
    }
  }

  getDefaultDefault(): unknown {
    switch (this.type.ordinal()) {
      case 3: return ''
      case 1: return false
      case 2: return 0
      case 4: return 0
      case 5:
        this.checkEnumClass()
        const constants = this.clazz!.getEnumConstants()
        if (constants.length === 0) throw new RangeError('Array index out of bounds')
        return constants[0]
      case 6: this.checkEnumClass(); return EnumSet.noneOf(this.clazz as Class<OptionEnum>)
      case 7: return null
      default: throw new IllegalStateException('Invalid type set for this layout option.')
    }
  }
  private static readonly BOOLEAN_CHOICES = ['false', 'true']
  getChoices(): string[] {
    if (this.choices === null) {
      switch (this.type.ordinal()) {
        case 5:
        case 6:
          this.checkEnumClass()
          this.choices = (this.clazz!.getEnumConstants() as OptionEnum[]).map(value => value.toString())
          break
        case 1: this.choices = LayoutOptionData.BOOLEAN_CHOICES; break
        default: this.choices = []
      }
    }
    return this.choices
  }
  getEnumValueCount(): number {
    switch (this.type.ordinal()) {
      case 5:
      case 6: this.checkEnumClass(); return this.clazz!.getEnumConstants().length
      default: return 0
    }
  }
  getEnumValue(intValue: number): OptionEnum | null {
    switch (this.type.ordinal()) {
      case 5:
      case 6:
        this.checkEnumClass()
        const constants = this.clazz!.getEnumConstants() as OptionEnum[]
        if (intValue < 0 || intValue >= constants.length) throw new RangeError('Array index out of bounds')
        return constants[intValue]!
      default: return null
    }
  }
  getTargets(): AbstractSet<LayoutOptionData.Target> { return this.targets }
  getDependencies(): LinkedList<Pair<LayoutOptionData, unknown>> { return this.dependencies }
  getId(): string { return this.id }
  getGroup(): string { return this.group }
  getType(): LayoutOptionData.Type { return this.type }
  getName(): string { return this.name }
  getDescription(): string { return this.description }
  getDefault(): unknown {
    if (isCloneable(this.defaultValue)) {
      const clone = ElkReflect.clone(this.defaultValue)
      if (clone === null) throw new IllegalStateException(`Couldn't clone property '${this.id}'. Make sure it's type is registered with the ElkReflect utility class.`)
      return clone
    }
    return this.defaultValue
  }
  getLowerBound(): Comparable<unknown> {
    if (this.lowerBound !== null && typeof this.lowerBound === 'object' && typeof (this.lowerBound as Comparable<unknown>).compareTo === 'function') return this.lowerBound as Comparable<unknown>
    return Property.NEGATIVE_INFINITY
  }
  setLowerBound(lowerBound: unknown): void { this.lowerBound = comparableBound(lowerBound) }
  getUpperBound(): Comparable<unknown> {
    if (this.upperBound !== null && typeof this.upperBound === 'object' && typeof (this.upperBound as Comparable<unknown>).compareTo === 'function') return this.upperBound as Comparable<unknown>
    return Property.POSITIVE_INFINITY
  }
  setUpperBound(upperBound: unknown): void { this.upperBound = comparableBound(upperBound) }
  getOptionClass(): Class<unknown> | null { return this.clazz }
  getVisibility(): LayoutOptionData.Visibility | null { return this.visibility }
  getLegacyIds(): string[] | null { return this.legacyIds }
}

export namespace LayoutOptionData {
  export class Type extends Enum<Type> {
    static readonly UNDEFINED = new Type('UNDEFINED', 0)
    static readonly BOOLEAN = new Type('BOOLEAN', 1)
    static readonly INT = new Type('INT', 2)
    static readonly STRING = new Type('STRING', 3)
    static readonly DOUBLE = new Type('DOUBLE', 4)
    static readonly ENUM = new Type('ENUM', 5)
    static readonly ENUMSET = new Type('ENUMSET', 6)
    static readonly OBJECT = new Type('OBJECT', 7)
    private constructor(name: string, ordinal: number) { super(name, ordinal) }
    static values(): Type[] { return [Type.UNDEFINED, Type.BOOLEAN, Type.INT, Type.STRING, Type.DOUBLE, Type.ENUM, Type.ENUMSET, Type.OBJECT] }
    static valueOf(name: string): Type { for (const value of Type.values()) if (value.name() === name) return value; throw new IllegalArgumentException(`No enum constant ${name}`) }
  }
  export class Target extends Enum<Target> {
    static readonly PARENTS = new Target('PARENTS', 0)
    static readonly NODES = new Target('NODES', 1)
    static readonly EDGES = new Target('EDGES', 2)
    static readonly PORTS = new Target('PORTS', 3)
    static readonly LABELS = new Target('LABELS', 4)
    private constructor(name: string, ordinal: number) { super(name, ordinal) }
    static values(): Target[] { return [Target.PARENTS, Target.NODES, Target.EDGES, Target.PORTS, Target.LABELS] }
    static valueOf(name: string): Target { for (const value of Target.values()) if (value.name() === name) return value; throw new IllegalArgumentException(`No enum constant ${name}`) }
  }
  export class Visibility extends Enum<Visibility> {
    static readonly VISIBLE = new Visibility('VISIBLE', 0)
    static readonly ADVANCED = new Visibility('ADVANCED', 1)
    static readonly HIDDEN = new Visibility('HIDDEN', 2)
    private constructor(name: string, ordinal: number) { super(name, ordinal) }
    static values(): Visibility[] { return [Visibility.VISIBLE, Visibility.ADVANCED, Visibility.HIDDEN] }
    static valueOf(name: string): Visibility { for (const value of Visibility.values()) if (value.name() === name) return value; throw new IllegalArgumentException(`No enum constant ${name}`) }
  }
  export class Builder {
    readonly data = {
      id: null as unknown as string, group: null as unknown as string, legacyIds: null as string[] | null,
      defaultValue: null as unknown, clazz: null as Class<unknown> | null, type: null as unknown as Type,
      name: null as unknown as string, description: null as unknown as string, targets: null as AbstractSet<Target> | null,
      visibility: null as Visibility | null, lowerBound: null as unknown, upperBound: null as unknown,
    }
    create(): LayoutOptionData { return new LayoutOptionData(this) }
    id(aid: string): this { this.data.id = aid; return this }
    group(agroup: string): this { this.data.group = agroup; return this }
    legacyIds(...alegacyIds: string[]): this { this.data.legacyIds = alegacyIds; return this }
    defaultValue(adefaultValue: unknown): this { this.data.defaultValue = adefaultValue; return this }
    optionClass(aclazz: Class<unknown> | null): this { this.data.clazz = aclazz; return this }
    type(atype: Type): this { this.data.type = atype; return this }
    name(aname: string): this { this.data.name = aname; return this }
    description(adescription: string): this { this.data.description = adescription; return this }
    targets(atargets: AbstractSet<Target> | null): this { this.data.targets = atargets; return this }
    visibility(avisibility: Visibility | null): this { this.data.visibility = avisibility; return this }
    lowerBound(alowerBound: unknown): this { this.data.lowerBound = alowerBound; return this }
    upperBound(aupperBound: unknown): this { this.data.upperBound = aupperBound; return this }
  }
}

// Java's primitive wrapper and String types implement Comparable. Keep that
// interface when the port represents their values as TypeScript primitives.
function comparableBound(value: unknown): unknown {
  if (typeof value === 'number') return Double.valueOf(value)
  if (typeof value === 'string' || typeof value === 'boolean') return new PrimitiveComparable(value)
  return value
}

class PrimitiveComparable extends JavaObject implements Comparable<unknown> {
  constructor(private readonly value: string | boolean) { super() }
  compareTo(other: unknown): number {
    const right = other instanceof PrimitiveComparable ? other.value : other
    if (typeof this.value === 'boolean' && typeof right === 'boolean') return Number(this.value) - Number(right)
    if (typeof this.value === 'string' && typeof right === 'string') {
      const length = Math.min(this.value.length, right.length)
      for (let index = 0; index < length; index++) {
        const difference = this.value.charCodeAt(index) - right.charCodeAt(index)
        if (difference !== 0) return difference
      }
      return this.value.length - right.length
    }
    throw new TypeError('Incompatible comparable values')
  }
  override equals(other: unknown): boolean { return this.value === (other instanceof PrimitiveComparable ? other.value : other) }
  override hashCode(): number { return javaHashCode(this.value) }
  override toString(): string { return String(this.value) }
}
