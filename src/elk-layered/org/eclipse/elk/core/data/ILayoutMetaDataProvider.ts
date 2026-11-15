/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutAlgorithmData } from './LayoutAlgorithmData.ts'
import type { LayoutCategoryData } from './LayoutCategoryData.ts'
import type { LayoutOptionData } from './LayoutOptionData.ts'

export interface ILayoutMetaDataProvider {
  apply(registry: ILayoutMetaDataProvider.Registry): void
}

export namespace ILayoutMetaDataProvider {
  export interface Registry {
    register(algorithmData: LayoutAlgorithmData): void
    register(optionData: LayoutOptionData): void
    register(categoryData: LayoutCategoryData): void
    addDependency(sourceOption: string, targetOption: string, requiredValue: unknown): void
    addOptionSupport(algorithm: string, option: string, defaultValue: unknown): void
  }
}
