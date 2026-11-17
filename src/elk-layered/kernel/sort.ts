/*******************************************************************************
 * Copyright 2008 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * GWT 2.11 Arrays.mergeSort translation under EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 *******************************************************************************/
/** Preserve GWT's comparison sequence, including nontransitive ELK comparators. */
export function sort<T>(array: T[], compare: (a: T, b: T) => number): void {
  const mergeSort = (temp: T[], values: T[], low: number, high: number, offset: number): void => {
    if (high - low < 7) {
      for (let i = low + 1; i < high; i++) for (let j = i; j > low && compare(values[j - 1]!, values[j]!) > 0; j--) {
        const value = values[j]!; values[j] = values[j - 1]!; values[j - 1] = value
      }
      return
    }
    let tempLow = low + offset
    const tempHigh = high + offset, tempMid = tempLow + ((tempHigh - tempLow) >> 1)
    mergeSort(values, temp, tempLow, tempMid, -offset)
    mergeSort(values, temp, tempMid, tempHigh, -offset)
    if (compare(temp[tempMid - 1]!, temp[tempMid]!) <= 0) {
      while (low < high) values[low++] = temp[tempLow++]!
      return
    }
    let top = tempMid
    while (low < high) values[low++] = top >= tempHigh || tempLow < tempMid && compare(temp[tempLow]!, temp[top]!) <= 0 ? temp[tempLow++]! : temp[top++]!
  }
  mergeSort(array.slice(), array, 0, array.length, 0)
}
