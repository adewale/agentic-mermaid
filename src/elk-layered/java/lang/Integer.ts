/* SPDX-License-Identifier: EPL-2.0 */
export class Integer {
  static reverse(value: number): number {
    let result = 0
    for (let bit = 0; bit < 32; bit++) {
      result = (result << 1) | (value & 1)
      value >>>= 1
    }
    return result
  }
}
