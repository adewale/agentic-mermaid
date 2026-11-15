/*
 * Copyright (C) 2011 The Guava Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
/* TypeScript translation: EPL-2.0. Guava 31.1-jre GWT-compatible source.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { IllegalArgumentException } from '../../../../java/lang/IllegalArgumentException.ts'

export class DoubleMath {
  private constructor() {}
  static fuzzyEquals(a: number, b: number, tolerance: number): boolean {
    if (!(tolerance >= 0)) throw new IllegalArgumentException(`tolerance (${tolerance}) must be >= 0`)
    return Math.abs(a - b) <= tolerance || a === b || (Number.isNaN(a) && Number.isNaN(b))
  }
  static fuzzyCompare(a: number, b: number, tolerance: number): number {
    if (DoubleMath.fuzzyEquals(a, b, tolerance)) return 0
    if (a < b) return -1
    if (a > b) return 1
    return Number(Number.isNaN(a)) - Number(Number.isNaN(b))
  }
}
