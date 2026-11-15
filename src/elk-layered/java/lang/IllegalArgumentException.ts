/* SPDX-License-Identifier: EPL-2.0 */
export class IllegalArgumentException extends Error {
  constructor(message = '', options?: ErrorOptions) { super(message, options); this.name = 'IllegalArgumentException' }
  override toString(): string { return 'java.lang.IllegalArgumentException' + (this.message ? ': ' + this.message : '') }
}
